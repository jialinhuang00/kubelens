package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

// exportState tracks the running export process and its progress.
type exportState struct {
	mu                 sync.Mutex
	running            bool
	paused             bool
	pid                int
	startedAt          time.Time
	totalNamespaces    int
	completedNamespaces int
	activeNamespaces   map[string]struct{}
	activeResources    map[string]struct{}
	fileCount          int
	minEtaSeconds      *int
	err                string
	output             string
}

var state = &exportState{
	activeNamespaces: make(map[string]struct{}),
	activeResources:  make(map[string]struct{}),
}

var snapshotDir = "k8s-snapshot"

var (
	reDiscovered = regexp.MustCompile(`Discovered (\d+) namespaces`)
	reSkip       = regexp.MustCompile(`=== Namespace: (.+?) === \(complete, skipping\)`)
	reNs         = regexp.MustCompile(`=== Namespace: (\S+?) ===`)
	reDoneNs     = regexp.MustCompile(`✓ Namespace (\S+) completed`)
	reFetch      = regexp.MustCompile(`→ fetching (\S+)`)
	reDoneRes    = regexp.MustCompile(`← (\S+) (?:done|failed)`)
)

func registerK8sExport(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/k8s-export/start", handleExportStart)
	mux.HandleFunc("GET /api/k8s-export/progress", handleExportProgress)
	mux.HandleFunc("POST /api/k8s-export/stop", handleExportStop)
}

// POST /api/k8s-export/start
// Spawns cmd/k8s-export binary (USE_GO_EXPORT=true) or scripts/k8s-export.sh.
// Parses stdout to track namespace progress and ETA.
func handleExportStart(w http.ResponseWriter, r *http.Request) {
	state.mu.Lock()
	if state.running {
		state.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]any{"error": "Export already running"})
		return
	}

	var body struct {
		Resume bool `json:"resume"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	state.running = true
	state.paused = false
	state.pid = 0
	state.startedAt = time.Now()
	state.totalNamespaces = 0
	state.completedNamespaces = 0
	state.activeNamespaces = make(map[string]struct{})
	state.activeResources = make(map[string]struct{})
	state.fileCount = 0
	state.minEtaSeconds = nil
	state.err = ""
	state.output = ""
	state.mu.Unlock()

	useGo := os.Getenv("USE_GO_EXPORT") == "true"
	var cmd *exec.Cmd
	if useGo {
		binary := filepath.Join("cmd", "k8s-export", "k8s-export")
		args := []string{}
		if body.Resume {
			args = append(args, "--resume")
		}
		cmd = exec.Command(binary, args...)
	} else {
		script := filepath.Join("scripts", "k8s-export.sh")
		args := []string{script}
		if body.Resume {
			args = append(args, "--resume")
		}
		cmd = exec.Command("bash", args...)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // new process group for group kill
	cmd.Dir = "."

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		state.mu.Lock()
		state.running = false
		state.err = err.Error()
		state.mu.Unlock()
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	state.mu.Lock()
	state.pid = cmd.Process.Pid
	state.mu.Unlock()

	go pipeOutput(stdout, false)
	go pipeOutput(stderr, true)
	go func() {
		cmd.Wait()
		count, _ := countFiles(snapshotDir)
		state.mu.Lock()
		state.running = false
		state.pid = 0
		state.fileCount = count
		if cmd.ProcessState != nil && cmd.ProcessState.ExitCode() != 0 && !state.paused {
			state.err = fmt.Sprintf("Process exited with code %d", cmd.ProcessState.ExitCode())
		}
		state.mu.Unlock()
	}()

	writeJSON(w, http.StatusOK, map[string]any{"started": true, "pid": cmd.Process.Pid, "resume": body.Resume})
}

// GET /api/k8s-export/progress
// Polled every 1s by frontend during export.
func handleExportProgress(w http.ResponseWriter, r *http.Request) {
	liveCount, _ := countFiles(snapshotDir)
	doneNs, _ := countDoneNamespaces(snapshotDir)

	_, errMarker := os.Stat(filepath.Join(snapshotDir, ".export-complete"))
	hasComplete := errMarker == nil

	state.mu.Lock()
	defer state.mu.Unlock()

	totalNs := state.totalNamespaces
	if totalNs == 0 && doneNs > 0 {
		// Server restarted — count namespace dirs as fallback.
		entries, err := os.ReadDir(snapshotDir)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
					totalNs++
				}
			}
		}
	}

	paused := state.paused
	if !state.running && !state.paused {
		if hasComplete {
			paused = false
		} else if liveCount > 0 {
			paused = true
		}
	}

	var etaSeconds *int
	if state.running && !state.startedAt.IsZero() && doneNs > 0 && totalNs > 0 {
		elapsed := time.Since(state.startedAt).Seconds()
		avgPerNs := elapsed / float64(doneNs)
		remaining := totalNs - doneNs
		raw := int(avgPerNs * float64(remaining))
		if state.minEtaSeconds == nil || raw < *state.minEtaSeconds {
			state.minEtaSeconds = &raw
		}
		etaSeconds = state.minEtaSeconds
	}

	activeNsList := make([]string, 0, len(state.activeNamespaces))
	for ns := range state.activeNamespaces {
		activeNsList = append(activeNsList, ns)
	}
	activeResList := make([]string, 0, len(state.activeResources))
	for res := range state.activeResources {
		activeResList = append(activeResList, res)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"running":             state.running,
		"paused":              paused,
		"totalNamespaces":     totalNs,
		"completedNamespaces": doneNs,
		"currentNamespace":    strings.Join(activeNsList, ", "),
		"activeResources":     activeResList,
		"fileCount":           liveCount,
		"etaSeconds":          etaSeconds,
		"error":               state.err,
	})
}

// POST /api/k8s-export/stop
// Sends SIGTERM to the entire process group (negative PID).
func handleExportStop(w http.ResponseWriter, r *http.Request) {
	state.mu.Lock()
	defer state.mu.Unlock()

	if !state.running || state.pid == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "No export running"})
		return
	}

	if err := syscall.Kill(-state.pid, syscall.SIGTERM); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	state.running = false
	state.paused = true
	writeJSON(w, http.StatusOK, map[string]any{"stopped": true})
}

// pipeOutput reads from a pipe, writes to stdout, and parses progress markers.
func pipeOutput(r io.Reader, _ bool) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			raw := string(buf[:n])
			os.Stdout.WriteString(raw)
			// Strip ANSI colour codes for parsing.
			text := stripANSI(raw)

			state.mu.Lock()
			if len(state.output) < 200000 {
				state.output += text
			}

			if m := reDiscovered.FindStringSubmatch(text); m != nil {
				fmt.Sscanf(m[1], "%d", &state.totalNamespaces)
			}

			skipped := map[string]bool{}
			for _, m := range reSkip.FindAllStringSubmatch(text, -1) {
				state.completedNamespaces++
				skipped[m[1]] = true
			}
			for _, m := range reNs.FindAllStringSubmatch(text, -1) {
				if !skipped[m[1]] {
					state.activeNamespaces[m[1]] = struct{}{}
				}
			}
			for _, m := range reDoneNs.FindAllStringSubmatch(text, -1) {
				delete(state.activeNamespaces, m[1])
			}
			for _, m := range reFetch.FindAllStringSubmatch(text, -1) {
				for _, res := range strings.Split(m[1], ",") {
					state.activeResources[res] = struct{}{}
				}
			}
			for _, m := range reDoneRes.FindAllStringSubmatch(text, -1) {
				for _, res := range strings.Split(m[1], ",") {
					delete(state.activeResources, res)
				}
			}
			state.mu.Unlock()
		}
		if err != nil {
			break
		}
	}
}

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func stripANSI(s string) string {
	return ansiRe.ReplaceAllString(s, "")
}

func countFiles(dir string) (int, error) {
	count := 0
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			return nil
		}
		if strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".tmp") {
			return nil
		}
		count++
		return nil
	})
	return count, err
}

func countDoneNamespaces(dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, nil
	}
	count := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, e.Name(), ".done")); err == nil {
			count++
		}
	}
	return count, nil
}
