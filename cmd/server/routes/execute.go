package routes

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"kubecmds-viz/server/store"
)

func registerExecute(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/execute", handleExecute)
}

// POST /api/execute
// Runs a single kubectl command and returns stdout.
//
// Typical commands:
//   - kubectl get pods -n <ns>
//   - kubectl get deployments -n <ns>
//   - kubectl describe pod <name> -n <ns>
//   - kubectl get all -n <ns>        ← output split into labelled sections
//   - kubectl get events -n <ns>
//   - kubectl get configmap <name> -n <ns> -o yaml
//   - kubectl top pods -n <ns>
func handleExecute(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !strings.HasPrefix(body.Command, "kubectl") {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":   "Only kubectl commands are allowed",
			"success": false,
		})
		return
	}

	// Snapshot mode — dispatch to store instead of live kubectl.
	if r.URL.Query().Get("snapshot") == "true" {
		result := store.HandleCommand(body.Command)
		writeJSON(w, http.StatusOK, map[string]any{
			"success": result.Success,
			"stdout":  result.Stdout,
			"error":   result.Error,
			"command": body.Command,
		})
		return
	}

	args := parseCommand(body.Command)

	cmd := exec.Command("kubectl", args...)
	cmd.WaitDelay = 30 * time.Second

	out, err := cmd.Output()
	if err != nil {
		var stderr string
		if ee, ok := err.(*exec.ExitError); ok {
			stderr = strings.TrimSpace(string(ee.Stderr))
		}
		if stderr == "" {
			stderr = err.Error()
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"success": false,
			"error":   stderr,
			"stdout":  "",
			"command": body.Command,
		})
		return
	}

	stdout := string(out)
	if strings.Contains(body.Command, "get all") {
		stdout = splitGetAllTables(stdout)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"stdout":  stdout,
		"command": body.Command,
	})
}

// parseCommand splits "kubectl <args...>" into args, stripping surrounding quotes.
func parseCommand(command string) []string {
	parts := strings.Fields(command)
	args := make([]string, 0, len(parts)-1)
	for _, p := range parts[1:] {
		// Strip surrounding single or double quotes.
		if len(p) >= 2 && ((p[0] == '\'' && p[len(p)-1] == '\'') || (p[0] == '"' && p[len(p)-1] == '"')) {
			p = p[1 : len(p)-1]
		}
		args = append(args, p)
	}
	return args
}

// splitGetAllTables splits multi-resource kubectl get all output into
// labelled sections: === DEPLOYMENT ===, === POD ===, etc.
func splitGetAllTables(output string) string {
	lines := strings.Split(output, "\n")
	isAllNamespaces := strings.Contains(output, "NAMESPACE")

	type table struct {
		resourceType string
		lines        []string
	}

	var tables []table
	var current *table

	flush := func() {
		if current != nil && len(current.lines) > 1 {
			tables = append(tables, *current)
		}
		current = nil
	}

	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}

		isHeader := (!isAllNamespaces && strings.HasPrefix(line, "NAME")) ||
			(isAllNamespaces && strings.HasPrefix(line, "NAMESPACE"))

		if isHeader {
			flush()
			current = &table{resourceType: "Unknown", lines: []string{line}}
			continue
		}

		if current != nil {
			if len(current.lines) == 1 {
				// First data line — detect resource type from name prefix.
				current.resourceType = detectResourceType(line, isAllNamespaces)
			}
			current.lines = append(current.lines, line)
		}
	}
	flush()

	var sb strings.Builder
	for i, t := range tables {
		if i > 0 {
			sb.WriteString("\n\n")
		}
		sb.WriteString("=== " + t.resourceType + " ===\n")
		sb.WriteString(strings.Join(t.lines, "\n"))
	}
	return sb.String()
}

func detectResourceType(line string, isAllNamespaces bool) string {
	parts := strings.Fields(line)
	idx := 0
	if isAllNamespaces {
		idx = 1
	}
	if len(parts) <= idx {
		return "Resources"
	}
	name := parts[idx]
	if !strings.Contains(name, "/") {
		return "Resources"
	}
	prefix := strings.ToLower(strings.SplitN(name, "/", 2)[0])
	switch prefix {
	case "deployment.apps":
		return "DEPLOYMENT"
	case "replicaset.apps":
		return "REPLICASET"
	case "statefulset.apps":
		return "STATEFULSET"
	case "daemonset.apps":
		return "DAEMONSET"
	case "pod":
		return "POD"
	case "service":
		return "SERVICE"
	case "horizontalpodautoscaler.autoscaling":
		return "HPA"
	case "cronjob.batch":
		return "CRONJOB"
	case "job.batch":
		return "JOB"
	default:
		return strings.ToUpper(strings.SplitN(prefix, ".", 2)[0])
	}
}
