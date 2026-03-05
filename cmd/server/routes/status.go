package routes

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func registerStatus(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/realtime/ping", handleRealtimePing)
	mux.HandleFunc("GET /api/snapshot/ping", handleSnapshotPing)
	mux.HandleFunc("GET /api/debug/memory", handleDebugMemory)
}

func handleRealtimePing(w http.ResponseWriter, r *http.Request) {
	envInfo := map[string]string{
		"PATH":              os.Getenv("PATH"),
		"HOME":              os.Getenv("HOME"),
		"KUBECONFIG":        os.Getenv("KUBECONFIG"),
		"working_directory": must(os.Getwd()),
	}

	kubectlPath, err := exec.LookPath("kubectl")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":      "kubectl not available",
			"error":       err.Error(),
			"environment": envInfo,
		})
		return
	}

	out, err := exec.Command("kubectl", "version", "--client", "-o", "json").Output()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":       "kubectl found but version failed",
			"kubectl_path": kubectlPath,
			"environment":  envInfo,
		})
		return
	}

	var versionObj struct {
		ClientVersion struct {
			GitVersion string `json:"gitVersion"`
		} `json:"clientVersion"`
	}
	gitVersion := "unknown"
	if json.Unmarshal(out, &versionObj) == nil && versionObj.ClientVersion.GitVersion != "" {
		gitVersion = versionObj.ClientVersion.GitVersion
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "healthy",
		"kubectl": map[string]string{
			"path":    kubectlPath,
			"version": gitVersion,
		},
		"environment": envInfo,
	})
}

func handleSnapshotPing(w http.ResponseWriter, r *http.Request) {
	// Resolve project root relative to cwd (server runs from project root via go run).
	marker := filepath.Join("k8s-snapshot", ".export-complete")

	_, err := os.Stat(marker)
	writeJSON(w, http.StatusOK, map[string]bool{
		"available": err == nil,
	})
}

func handleDebugMemory(w http.ResponseWriter, r *http.Request) {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	writeJSON(w, http.StatusOK, map[string]uint64{
		"rss":       ms.Sys / 1024 / 1024,
		"heapUsed":  ms.HeapInuse / 1024 / 1024,
		"heapTotal": ms.HeapSys / 1024 / 1024,
	})
}


// --- helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func must(s string, err error) string {
	if err != nil {
		return ""
	}
	return s
}
