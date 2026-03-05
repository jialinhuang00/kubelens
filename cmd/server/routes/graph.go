package routes

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"sync"
	"time"

	"kubecmds-viz/server/graph"
	"kubecmds-viz/server/store"
)

func registerGraph(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/graph", handleGraph)
}

// GET /api/graph
// Snapshot mode: reads from k8s-snapshot/ YAML files.
// Realtime mode: runs 9 parallel kubectl get -A -o json batches.
func handleGraph(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("snapshot") == "true" {
		handleGraphSnapshot(w)
		return
	}
	handleGraphRealtime(w, r)
}

// --- Snapshot ---

func handleGraphSnapshot(w http.ResponseWriter) {
	namespaces := store.ListBackupNamespaces()
	getItems := func(ns, resourceKey string) []graph.K8sItem {
		list := store.LoadYaml(resourceKey+".yaml", ns)
		if list == nil {
			return nil
		}
		return list.Items
	}
	result := graph.BuildGraph(getItems, namespaces)
	writeJSON(w, http.StatusOK, result)
}

// --- Realtime ---

type batchSpec struct {
	resources string
	keys      []string
}

var coreBatches = []batchSpec{
	{"deployments,statefulsets,daemonsets,cronjobs", []string{"deployments", "statefulsets", "daemonsets", "cronjobs"}},
	{"services,configmaps,ingresses", []string{"services", "configmaps", "ingresses"}},
	{"secrets,serviceaccounts,rolebindings", []string{"secrets", "serviceaccounts", "rolebindings"}},
	{"pods", []string{"pods"}},
	{"hpa", []string{"horizontalpodautoscalers"}},
	{"pvc", []string{"persistentvolumeclaims"}},
}

var optionalBatches = []batchSpec{
	{"gateways.gateway.networking.k8s.io", []string{"gateways"}},
	{"httproutes.gateway.networking.k8s.io", []string{"httproutes"}},
	{"tcproutes.gateway.networking.k8s.io", []string{"tcproutes"}},
}

// kindToKey maps K8s Kind → resourceKey used in getItemsFn.
var kindToKey = map[string]string{
	"Deployment":              "deployments",
	"StatefulSet":             "statefulsets",
	"DaemonSet":               "daemonsets",
	"CronJob":                 "cronjobs",
	"Service":                 "services",
	"ConfigMap":               "configmaps",
	"Ingress":                 "ingresses",
	"Secret":                  "secrets",
	"ServiceAccount":          "serviceaccounts",
	"RoleBinding":             "rolebindings",
	"Pod":                     "pods",
	"HorizontalPodAutoscaler": "horizontalpodautoscalers",
	"PersistentVolumeClaim":   "persistentvolumeclaims",
	"Gateway":                 "gateways",
	"HTTPRoute":               "httproutes",
	"TCPRoute":                "tcproutes",
}

type batchResult struct {
	items []graph.K8sItem
	err   string
}

func handleGraphRealtime(w http.ResponseWriter, r *http.Request) {
	allBatches := append(coreBatches, optionalBatches...)
	results := make([]batchResult, len(allBatches))

	var wg sync.WaitGroup
	for i, batch := range allBatches {
		wg.Add(1)
		go func(i int, b batchSpec) {
			defer wg.Done()
			results[i] = fetchBatch(b, r)
		}(i, batch)
	}
	wg.Wait()

	// All core batches failed → kubectl is broken.
	coreFailures := 0
	for i := range coreBatches {
		if results[i].err != "" {
			coreFailures++
		}
	}
	if coreFailures == len(coreBatches) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"message": results[0].err,
		})
		return
	}

	// Build ns → resourceKey → []K8sItem index.
	nsData := map[string]map[string][]graph.K8sItem{}
	allNsSet := map[string]bool{}

	for i, batch := range allBatches {
		for _, item := range results[i].items {
			meta, _ := item["metadata"].(map[string]interface{})
			ns, _ := meta["namespace"].(string)
			if ns == "" {
				ns = "_cluster"
			}
			kind, _ := item["kind"].(string)
			key, ok := kindToKey[kind]
			if !ok {
				key = batch.keys[0]
			}

			allNsSet[ns] = true
			if nsData[ns] == nil {
				nsData[ns] = map[string][]graph.K8sItem{}
			}
			nsData[ns][key] = append(nsData[ns][key], item)
		}
	}

	namespaces := make([]string, 0, len(allNsSet))
	for ns := range allNsSet {
		namespaces = append(namespaces, ns)
	}

	getItems := func(ns, resourceKey string) []graph.K8sItem {
		if m, ok := nsData[ns]; ok {
			return m[resourceKey]
		}
		return nil
	}

	result := graph.BuildGraph(getItems, namespaces)
	writeJSON(w, http.StatusOK, result)
}

// fetchBatch runs a single kubectl get batch and returns parsed items.
func fetchBatch(b batchSpec, r *http.Request) batchResult {
	args := []string{"get", b.resources, "-A", "-o", "json"}
	cmd := exec.Command("kubectl", args...)
	cmd.WaitDelay = 30 * time.Second

	out, err := cmd.Output()
	if err != nil {
		msg := err.Error()
		if ee, ok := err.(*exec.ExitError); ok {
			msg = string(ee.Stderr)
		}
		log.Printf("[graph] kubectl get %s: %s", b.resources, msg)
		return batchResult{err: msg}
	}

	var list struct {
		Items []graph.K8sItem `json:"items"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return batchResult{err: fmt.Sprintf("parse error: %v", err)}
	}

	log.Printf("[graph] kubectl get %s: %d items (%.1fKB)",
		b.resources, len(list.Items), float64(len(out))/1024)

	return batchResult{items: list.Items}
}
