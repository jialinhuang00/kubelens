package routes

import (
	"net/http"
	"os/exec"
	"strings"
	"sync"
)

var resourceTypes = []string{
	"deployments", "pods", "services", "statefulsets", "daemonsets",
	"cronjobs", "jobs", "configmaps", "secrets", "serviceaccounts",
	"persistentvolumeclaims", "roles", "rolebindings", "ingresses",
	"endpoints", "networkpolicies", "horizontalpodautoscalers",
	"poddisruptionbudgets", "resourcequotas", "limitranges",
	"gateways.gateway.networking.k8s.io",
	"httproutes.gateway.networking.k8s.io",
	"tcproutes.gateway.networking.k8s.io",
}

// keyMap normalises verbose resource type names to short display keys.
var keyMap = map[string]string{
	"gateways.gateway.networking.k8s.io":   "gateways",
	"httproutes.gateway.networking.k8s.io": "httproutes",
	"tcproutes.gateway.networking.k8s.io":  "tcproutes",
}

func registerResourceCounts(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/resource-counts", handleResourceCounts)
}

// GET /api/resource-counts?namespace=X
// Returns { resourceType: count } for all resource types in a namespace.
// Used by namespace sidebar badges (e.g. "12 pods, 3 deployments").
// 22 parallel kubectl calls in realtime mode.
func handleResourceCounts(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if ns == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "namespace query parameter is required"})
		return
	}

	// TODO: snapshot mode — reads counts from k8s-snapshot/ YAML files.
	// Implemented in step 8 after snapshot/ package is ported.

	type result struct {
		key   string
		count int
	}

	results := make([]result, len(resourceTypes))
	var wg sync.WaitGroup

	for i, rt := range resourceTypes {
		wg.Add(1)
		go func(i int, rt string) {
			defer wg.Done()
			key := rt
			if k, ok := keyMap[rt]; ok {
				key = k
			}
			count := kubectlCount(rt, ns)
			results[i] = result{key, count}
		}(i, rt)
	}
	wg.Wait()

	counts := make(map[string]int, len(results))
	for _, r := range results {
		counts[r.key] = r.count
	}

	writeJSON(w, http.StatusOK, map[string]any{"success": true, "counts": counts})
}

// kubectlCount runs kubectl get <resourceType> -n <ns> --no-headers and counts non-empty lines.
func kubectlCount(resourceType, ns string) int {
	out, err := exec.Command("kubectl", "get", resourceType, "-n", ns, "--no-headers").Output()
	if err != nil {
		return 0
	}
	count := 0
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}
