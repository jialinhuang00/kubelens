package routes

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
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

// groupOf extracts the API group from an apiVersion ("apps/v1" -> "apps", "v1" -> "").
func groupOf(apiVersion string) string {
	if i := strings.Index(apiVersion, "/"); i >= 0 {
		return apiVersion[:i]
	}
	return ""
}

type batchResult struct {
	items []graph.K8sItem
	err   string
}

func handleGraphRealtime(w http.ResponseWriter, _ *http.Request) {
	res := store.GraphResources()

	// One batch for all built-in types; individual calls for CRDs so a missing
	// CRD doesn't fail the core fetch. Core batch is index 0.
	var builtinTypes, batches []string
	for _, rc := range res {
		if rc.ResourceType != rc.Key { // CRD
			batches = append(batches, rc.ResourceType)
		} else {
			builtinTypes = append(builtinTypes, rc.ResourceType)
		}
	}
	batches = append([]string{strings.Join(builtinTypes, ",")}, batches...)

	// "group/kind" -> resourceKey, so kinds sharing a Kind name across API
	// groups (e.g. Gateway) don't collide.
	groupKindToKey := map[string]string{}
	for _, rc := range res {
		groupKindToKey[rc.Group+"/"+rc.Kind] = rc.Key
	}

	results := make([]batchResult, len(batches))
	var wg sync.WaitGroup
	for i, b := range batches {
		wg.Add(1)
		go func(i int, resources string) {
			defer wg.Done()
			results[i] = fetchBatch(resources)
		}(i, b)
	}
	wg.Wait()

	// Core batch (index 0) failing means kubectl itself is broken.
	if results[0].err != "" {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"message": results[0].err})
		return
	}

	// Build ns → resourceKey → []K8sItem index.
	nsData := map[string]map[string][]graph.K8sItem{}
	allNsSet := map[string]bool{}
	for _, br := range results {
		for _, item := range br.items {
			meta, _ := item["metadata"].(map[string]interface{})
			ns, _ := meta["namespace"].(string)
			if ns == "" {
				ns = "_cluster"
			}
			kind, _ := item["kind"].(string)
			apiVersion, _ := item["apiVersion"].(string)
			key, ok := groupKindToKey[groupOf(apiVersion)+"/"+kind]
			if !ok {
				continue
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
func fetchBatch(resources string) batchResult {
	args := []string{"get", resources, "-A", "-o", "json"}
	cmd := exec.Command("kubectl", args...)
	cmd.WaitDelay = 30 * time.Second

	out, err := cmd.Output()
	if err != nil {
		msg := err.Error()
		if ee, ok := err.(*exec.ExitError); ok {
			msg = string(ee.Stderr)
		}
		log.Printf("[graph] kubectl get %s: %s", resources, msg)
		return batchResult{err: msg}
	}

	var list struct {
		Items []graph.K8sItem `json:"items"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return batchResult{err: fmt.Sprintf("parse error: %v", err)}
	}

	log.Printf("[graph] kubectl get %s: %d items (%.1fKB)",
		resources, len(list.Items), float64(len(out))/1024)

	return batchResult{items: list.Items}
}
