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
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"kubelens/server/store"
)

// exportState tracks the running export process and its progress.
type exportState struct {
	mu      sync.Mutex
	running bool
	paused  bool
	// "I know there's a half-finished export; let me use the app anyway."
	// handleExportProgress recomputes paused from disk on every poll, so clearing
	// the flag above is not enough — the partial files are still there and the
	// next poll would put the modal straight back. Only the user sets this.
	pausedDismissed bool
	pid             int
	startedAt       time.Time
	// How long the last finished run took. The frontend prints it on the done
	// panel ("Export complete — 47 files in 12s"), so a missing value is not
	// an error, just a shorter sentence.
	elapsedSeconds *int
	// True from the moment a fresh (non-resume) export starts until its first
	// progress line arrives. Until then the directory still holds the previous
	// export, and reporting those counts makes a new run appear to begin at 100%.
	freshStart          bool
	totalNamespaces     int
	completedNamespaces int
	activeNamespaces    map[string]struct{}
	activeResources     map[string]struct{}
	fileCount           int
	minEtaSeconds       *int
	err                 string
	output              string
	// The error stream on its own, capped. The UI shows `err` and nothing else,
	// so a refusal explained on stderr has to travel through here to be read.
	stderrTail string
}

var state = &exportState{
	activeNamespaces: make(map[string]struct{}),
	activeResources:  make(map[string]struct{}),
}

// Where this route reads and writes, through the one helper the loader and the
// ping handler also use. It was a bare string here, so `K8S_SNAPSHOT_PATH`
// moved Snapshot mode and left the export behind.
//
// Still a var so tests can point it at a temp directory; production never
// assigns it.
var snapshotDir = store.SnapshotDir

var (
	reDiscovered = regexp.MustCompile(`Discovered (\d+) namespaces`)
	reSkip       = regexp.MustCompile(`=== Namespace: (.+?) === \(complete, skipping\)`)
	reNs         = regexp.MustCompile(`=== Namespace: (\S+?) ===`)
	reDoneNs     = regexp.MustCompile(`✓ Namespace (\S+) completed`)
	reFetch      = regexp.MustCompile(`→ fetching (\S+)`)
	reDoneRes    = regexp.MustCompile(`← (\S+) (?:done|failed)`)
)

// The frontend calls GET /api/snapshot and POST /api/snapshot with a `command`
// field. These used to be /api/k8s-export/{start,progress,stop}; commit daed7fa
// renamed them in the Node backend and the frontend on 2026-03-07 and left this
// file behind, so every export control here answered 404 under `npm run dev:go`.
func registerK8sExport(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/snapshot", handleExportProgress)
	mux.HandleFunc("POST /api/snapshot", handleExportCommand)
	mux.HandleFunc("GET /api/export/ping", handleExportPing)
}

// POST /api/snapshot — one route, four commands, matching api/routes/snapshot.js.
func handleExportCommand(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var cmd struct {
		Command string `json:"command"`
	}
	json.Unmarshal(body, &cmd)

	switch cmd.Command {
	case "stop":
		handleExportStop(w, r)
	case "clear":
		handleExportClear(w, r)
	case "discard":
		handleExportDiscard(w, r)
	default:
		handleExportStart(w, r, body)
	}
}

// childEnv is the environment an exporter child runs with: this process's, plus
// the resolved directory under the name that wins everywhere, minus the older
// name so nothing the user left set can outrank it.
func childEnv(dir string) []string {
	out := []string{}
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "K8S_SNAPSHOT_PATH=") || strings.HasPrefix(kv, "K8S_SNAPSHOT_DIR=") {
			continue
		}
		out = append(out, kv)
	}
	return append(out, "K8S_SNAPSHOT_PATH="+dir)
}

// GET /api/export/ping — whether GNU parallel is installed, for the mode dropdown.
func handleExportPing(w http.ResponseWriter, r *http.Request) {
	_, err := exec.LookPath("parallel")
	writeJSON(w, http.StatusOK, map[string]any{"parallel": err == nil})
}

// Start an export. Spawns whichever exporter `mode` names, and parses its stdout
// for namespace progress and ETA.
func handleExportStart(w http.ResponseWriter, r *http.Request, rawBody []byte) {
	state.mu.Lock()
	if state.running {
		state.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]any{"error": "Export already running"})
		return
	}

	var body struct {
		Resume  bool   `json:"resume"`
		Mode    string `json:"mode"`
		Workers int    `json:"workers"`
	}
	json.Unmarshal(rawBody, &body)

	spawnCmd, args, err := exporterCommand(body.Mode, body.Workers)
	if err != nil {
		state.err = err.Error()
		state.mu.Unlock()
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if body.Resume {
		args = append(args, "--resume")
	}

	// A fresh start drops the previous run's markers before spawning. Without
	// this the first polls see .export-complete from last time and report the
	// new export as already finished.
	if !body.Resume {
		os.Remove(filepath.Join(snapshotDir(), ".export-complete"))
		if entries, err := os.ReadDir(snapshotDir()); err == nil {
			for _, e := range entries {
				if e.IsDir() {
					os.Remove(filepath.Join(snapshotDir(), e.Name(), ".done"))
				}
			}
		}
	}

	state.running = true
	state.paused = false
	state.pausedDismissed = false
	state.elapsedSeconds = nil
	state.freshStart = !body.Resume
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
	state.stderrTail = ""
	state.mu.Unlock()

	cmd := exec.Command(spawnCmd, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // new process group for group kill
	cmd.Dir = "."
	// Same handoff the Node route does: tell the child where to write rather
	// than letting it resolve for itself. Without this the child inherited the
	// raw variables, so with K8S_SNAPSHOT_PATH and K8S_SNAPSHOT_DIR both set and
	// pointing at different directories, this route read one and the export
	// wrote the other.
	cmd.Env = childEnv(snapshotDir())

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
		count, _ := countFiles(snapshotDir())
		state.mu.Lock()
		if !state.startedAt.IsZero() {
			secs := int(time.Since(state.startedAt).Seconds())
			state.elapsedSeconds = &secs
		}
		state.running = false
		state.pid = 0
		state.fileCount = count
		if cmd.ProcessState != nil && cmd.ProcessState.ExitCode() != 0 && !state.paused {
			state.err = exportFailureMessage(cmd.ProcessState.ExitCode(), state.stderrTail)
		}
		state.mu.Unlock()
	}()

	writeJSON(w, http.StatusOK, map[string]any{"started": true, "pid": cmd.Process.Pid, "resume": body.Resume})
}

// exporterCommand maps the mode the user picked in the dropdown to a command,
// mirroring the same switch in api/routes/snapshot.js. The Go server used to
// ignore mode entirely and always run its own binary, so picking "node" or
// "bash" there ran neither.
func exporterCommand(mode string, workers int) (string, []string, error) {
	script := func(name, flag string) (string, []string, error) {
		args := []string{filepath.Join("scripts", name)}
		if workers > 0 {
			args = append(args, flag, strconv.Itoa(workers))
		}
		if strings.HasSuffix(name, ".js") {
			return "node", args, nil
		}
		return "bash", args, nil
	}

	switch mode {
	case "node":
		return script("snapshot-node.js", "--jobs")
	case "workers":
		return script("snapshot-node-workers.js", "--workers")
	case "procs":
		return script("snapshot-node-procs.js", "--procs")
	case "go", "":
		binary := filepath.Join("cmd", "k8s-export", "k8s-export")
		if _, err := os.Stat(binary); err != nil {
			return "", nil, fmt.Errorf("go exporter not built. Run: cd cmd/k8s-export && go build -o k8s-export . — or pick another mode")
		}
		args := []string{}
		if workers > 0 {
			args = append(args, "-jobs", strconv.Itoa(workers))
		}
		return binary, args, nil
	default: // bash, bash-parallel
		return script("snapshot-bash.sh", "--jobs")
	}
}

// GET /api/snapshot
// Polled every 1s by frontend during export.
func handleExportProgress(w http.ResponseWriter, r *http.Request) {
	liveCount, _ := countFiles(snapshotDir())
	doneNs, _ := countDoneNamespaces(snapshotDir())

	_, errMarker := os.Stat(filepath.Join(snapshotDir(), ".export-complete"))
	hasComplete := errMarker == nil

	state.mu.Lock()
	defer state.mu.Unlock()

	totalNs := state.totalNamespaces
	if totalNs == 0 && doneNs > 0 {
		// Server restarted — count namespace dirs as fallback.
		entries, err := os.ReadDir(snapshotDir())
		if err == nil {
			for _, e := range entries {
				if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
					totalNs++
				}
			}
		}
	}

	// Derived from the filesystem, never from state.paused alone, and the same
	// four conditions as api/routes/snapshot.js. Trusting the in-memory flag
	// instead meant a stop that produced zero files stayed "paused" forever,
	// showing a modal whose only button was Resume with nothing to resume; and
	// a failed export that left half a directory got the paused panel here
	// while Node showed the error panel with Retry.
	paused := !state.running &&
		!hasComplete &&
		liveCount > 0 &&
		state.err == "" &&
		!state.pausedDismissed

	// Only the paused panel shows these two, and a running export polls this route
	// once a second — no reason to shell out to kubectl on every one of those.
	var snapshotContext, currentContext *string
	if paused {
		snapshotContext = readExportContext()
		currentContext = currentKubectlContext()
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

	// Suppress the previous export's counts until the new one's first progress
	// line arrives, or a fresh run appears to start at 100%.
	if state.freshStart {
		liveCount = 0
		doneNs = 0
		totalNs = 0
	}

	// While running, count up from startedAt; once finished, report what the
	// completed run took.
	elapsedSeconds := state.elapsedSeconds
	if state.running && !state.startedAt.IsZero() {
		secs := int(time.Since(state.startedAt).Seconds())
		elapsedSeconds = &secs
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
		"elapsedSeconds":      elapsedSeconds,
		"error":               state.err,
		"snapshotContext":     snapshotContext,
		"currentContext":      currentContext,
	})
}

// The cluster the export on disk was started against. Written by the exporters
// right after they clear the directory; absent for snapshots exported before
// that existed, and for a directory nobody has exported into yet.
func readExportContext() *string {
	raw, err := os.ReadFile(filepath.Join(snapshotDir(), ".export-context"))
	if err != nil {
		return nil
	}
	var parsed struct {
		Context string `json:"context"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil || parsed.Context == "" {
		return nil
	}
	return &parsed.Context
}

// Which cluster kubectl is pointed at right now. A package var rather than a
// plain function so tests can replace it; left alone it reads whatever
// kubeconfig the machine has, which is both unassertable and a unit test
// reaching outside the repo.
var currentKubectlContext = func() *string {
	out, err := exec.Command("kubectl", "config", "current-context").Output()
	if err != nil {
		return nil // no kubectl, no kubeconfig, or no context selected
	}
	name := strings.TrimSpace(string(out))
	if name == "" {
		return nil
	}
	return &name
}

// Dismiss a finished/failed/paused state so it stops blocking the home page.
func handleExportClear(w http.ResponseWriter, r *http.Request) {
	state.mu.Lock()
	defer state.mu.Unlock()

	if state.running {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "Export running"})
		return
	}
	state.err = ""
	state.paused = false
	state.pausedDismissed = true
	writeJSON(w, http.StatusOK, map[string]any{"cleared": true})
}

// Throw the partial export away so the next run starts from nothing.
func handleExportDiscard(w http.ResponseWriter, r *http.Request) {
	state.mu.Lock()
	defer state.mu.Unlock()

	if state.running {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "Export running"})
		return
	}
	if err := os.RemoveAll(snapshotDir()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	state.paused = false
	state.pausedDismissed = false
	state.err = ""
	state.fileCount = 0
	state.totalNamespaces = 0
	state.completedNamespaces = 0
	writeJSON(w, http.StatusOK, map[string]any{"discarded": true})
}

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

const stderrTailLimit = 2000

// pipeOutput reads from a pipe, writes to stdout, and parses progress markers.
// `isStderr` keeps a separate tail of the error stream: the exporters explain
// refusals in full there ("holds a snapshot of X, and kubectl is on Y"), and the
// UI renders only `error`, so without this a Resume that hit the cross-cluster
// guard showed "Process exited with code 1" and no reason.
func pipeOutput(r io.Reader, isStderr bool) {
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
			if isStderr {
				state.stderrTail += text
				if len(state.stderrTail) > stderrTailLimit {
					state.stderrTail = state.stderrTail[len(state.stderrTail)-stderrTailLimit:]
				}
			}

			if m := reDiscovered.FindStringSubmatch(text); m != nil {
				fmt.Sscanf(m[1], "%d", &state.totalNamespaces)
				state.freshStart = false // the exporter is rewriting the directory now
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
