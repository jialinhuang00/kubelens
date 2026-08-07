package routes

import (
	"net/http"
	"os/exec"
	"strings"

	"kubelens/server/store"
)

func registerDiscovery(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/api-resources", handleApiResources)
}

// ApiResource is one row of `kubectl api-resources`. JSON tags must match what
// api/utils/api-resources.ts emits — the frontend reads this route from either
// backend and cannot tell them apart.
type ApiResource struct {
	Name         string `json:"name"`         // bare plural, e.g. "virtualservices"
	Kind         string `json:"kind"`         // Kind, e.g. "VirtualService"
	Group        string `json:"group"`        // API group ("" = core)
	ResourceType string `json:"resourceType"` // kubectl target, e.g. "virtualservices.networking.istio.io"
}

// parseApiResources reads the table `kubectl api-resources` prints. There is no
// JSON output mode. Columns are NAME [SHORTNAMES] APIVERSION NAMESPACED KIND, and
// SHORTNAMES is optional, so read from the right: kind last, apiVersion last-2.
func parseApiResources(stdout string) []ApiResource {
	out := []ApiResource{}
	lines := strings.Split(stdout, "\n")
	if len(lines) > 0 {
		lines = lines[1:] // drop the header
	}
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		cols := strings.Fields(line)
		if len(cols) < 4 {
			continue
		}
		name := cols[0]
		kind := cols[len(cols)-1]
		apiVersion := cols[len(cols)-3]
		group := ""
		if i := strings.Index(apiVersion, "/"); i >= 0 {
			group = apiVersion[:i]
		}
		resourceType := name
		if group != "" {
			resourceType = name + "." + group
		}
		out = append(out, ApiResource{Name: name, Kind: kind, Group: group, ResourceType: resourceType})
	}
	return out
}

func filterExcluded(resources []ApiResource) []ApiResource {
	groups, names := store.LoadDiscoveryExclude()
	exGroups := make(map[string]bool, len(groups))
	for _, g := range groups {
		exGroups[g] = true
	}
	exNames := make(map[string]bool, len(names))
	for _, n := range names {
		exNames[n] = true
	}
	kept := []ApiResource{}
	for _, r := range resources {
		if exGroups[r.Group] || exNames[r.Name] {
			continue
		}
		kept = append(kept, r)
	}
	return kept
}

// GET /api/api-resources — namespaced kinds the cluster actually has, for the
// visibility panel. A broken APIService (a metrics adapter that is down, say)
// makes kubectl exit non-zero while still listing the working resources on
// stdout, so salvage those instead of returning nothing.
func handleApiResources(w http.ResponseWriter, r *http.Request) {
	cmd := exec.Command("kubectl", "api-resources", "--verbs=list", "--namespaced=true")
	var stderr strings.Builder
	cmd.Stderr = &stderr
	stdout, err := cmd.Output()

	if err == nil {
		writeJSON(w, http.StatusOK, map[string]any{"resources": filterExcluded(parseApiResources(string(stdout)))})
		return
	}
	if len(stdout) > 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"resources": filterExcluded(parseApiResources(string(stdout))),
			"warning":   strings.TrimSpace(stderr.String()),
		})
		return
	}
	msg := strings.TrimSpace(stderr.String())
	if msg == "" {
		msg = err.Error()
	}
	writeJSON(w, http.StatusOK, map[string]any{"resources": []ApiResource{}, "error": msg})
}
