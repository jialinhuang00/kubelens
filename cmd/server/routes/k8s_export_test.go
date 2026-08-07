package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// post drives POST /api/snapshot the way the frontend does and returns the
// decoded body plus the status code.
func post(t *testing.T, body string) (map[string]any, int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/snapshot", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handleExportCommand(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return out, rec.Code
}

func progress(t *testing.T) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/snapshot", nil)
	rec := httptest.NewRecorder()
	handleExportProgress(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return out
}

// withSnapshotDir points the handlers at a temp directory holding a partial
// export: some files, no .export-complete. That combination is what the code
// calls "paused".
func withSnapshotDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "demo"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "demo", "pods.yaml"), []byte("items: []\n"), 0644); err != nil {
		t.Fatal(err)
	}
	prev := snapshotDir
	snapshotDir = dir
	t.Cleanup(func() { snapshotDir = prev })

	// Stub the live-cluster lookup: the real one reads this machine's kubeconfig,
	// so its result cannot be asserted and the test would depend on the developer.
	prevCtx := currentKubectlContext
	currentKubectlContext = func() *string { return nil }
	t.Cleanup(func() { currentKubectlContext = prevCtx })

	// Reset field by field: assigning a fresh struct would overwrite state.mu
	// while it is held, and a zeroed mutex unlocks into a fatal error.
	state.mu.Lock()
	state.running = false
	state.paused = false
	state.pausedDismissed = false
	state.pid = 0
	state.totalNamespaces = 0
	state.completedNamespaces = 0
	state.activeNamespaces = make(map[string]struct{})
	state.activeResources = make(map[string]struct{})
	state.fileCount = 0
	state.minEtaSeconds = nil
	state.err = ""
	state.output = ""
	state.mu.Unlock()
	return dir
}

func TestProgressReportsPausedForPartialExport(t *testing.T) {
	withSnapshotDir(t)

	got := progress(t)
	if got["paused"] != true {
		t.Fatalf("paused = %v, want true (files on disk, no completion marker)", got["paused"])
	}
	if got["fileCount"] != float64(1) {
		t.Errorf("fileCount = %v, want 1", got["fileCount"])
	}
}

func TestCompletionMarkerClearsPaused(t *testing.T) {
	dir := withSnapshotDir(t)
	os.WriteFile(filepath.Join(dir, ".export-complete"), []byte("{}\n"), 0644)

	if got := progress(t); got["paused"] != false {
		t.Fatalf("paused = %v, want false once .export-complete exists", got["paused"])
	}
}

// The regression this guards: paused is recomputed from disk on every poll, so a
// dismiss that only cleared state.paused was undone one second later.
func TestClearKeepsPausedDismissedAcrossPolls(t *testing.T) {
	withSnapshotDir(t)

	if got, code := post(t, `{"command":"clear"}`); code != http.StatusOK || got["cleared"] != true {
		t.Fatalf("clear returned %d %v", code, got)
	}
	if got := progress(t); got["paused"] != false {
		t.Fatalf("paused = %v after clear, want false", got["paused"])
	}
	if got := progress(t); got["paused"] != false {
		t.Fatalf("paused = %v on the second poll, want false — the flag did not stick", got["paused"])
	}
}

func TestDiscardDeletesTheSnapshotDirectory(t *testing.T) {
	dir := withSnapshotDir(t)

	if got, code := post(t, `{"command":"discard"}`); code != http.StatusOK || got["discarded"] != true {
		t.Fatalf("discard returned %d %v", code, got)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("snapshot dir still present after discard: %v", err)
	}
	if got := progress(t); got["paused"] != false || got["fileCount"] != float64(0) {
		t.Fatalf("after discard: paused=%v fileCount=%v, want false and 0", got["paused"], got["fileCount"])
	}
}

// Discard also re-arms the panel: the next partial export must show it again.
func TestDiscardResetsPausedDismissed(t *testing.T) {
	dir := withSnapshotDir(t)
	post(t, `{"command":"clear"}`)
	post(t, `{"command":"discard"}`)

	os.MkdirAll(filepath.Join(dir, "demo"), 0755)
	os.WriteFile(filepath.Join(dir, "demo", "pods.yaml"), []byte("items: []\n"), 0644)

	if got := progress(t); got["paused"] != true {
		t.Fatalf("paused = %v, want true — discard should have cleared the dismissal", got["paused"])
	}
}

// A start→stop that produced nothing has nothing to resume. Trusting the
// in-memory paused flag left the modal up forever with a single Resume button.
func TestStopWithZeroFilesIsNotPaused(t *testing.T) {
	dir := withSnapshotDir(t)
	os.RemoveAll(filepath.Join(dir, "demo"))

	state.mu.Lock()
	state.paused = true // what handleExportStop leaves behind
	state.mu.Unlock()

	if got := progress(t); got["paused"] != false {
		t.Fatalf("paused = %v with 0 files, want false — nothing to resume", got["paused"])
	}
}

// A failed export that left half a directory belongs to the error panel (Retry /
// Dismiss), not the paused panel (Resume / Start over). Node has always had the
// `&& !error` term; this side did not.
func TestErrorSuppressesPaused(t *testing.T) {
	withSnapshotDir(t)

	state.mu.Lock()
	state.err = "Process exited with code 1"
	state.mu.Unlock()

	if got := progress(t); got["paused"] != false {
		t.Fatalf("paused = %v with an error set, want false", got["paused"])
	}
}

// The frontend prints this on the done panel; Go omitted the key entirely, so
// `elapsed()` was empty and the sentence lost its "in 12s".
func TestProgressReportsElapsedSecondsAfterARun(t *testing.T) {
	withSnapshotDir(t)

	twelve := 12
	state.mu.Lock()
	state.elapsedSeconds = &twelve
	state.mu.Unlock()

	if got := progress(t); got["elapsedSeconds"] != float64(12) {
		t.Fatalf("elapsedSeconds = %v, want 12", got["elapsedSeconds"])
	}
}

func TestProgressCarriesEveryFieldNodeReturns(t *testing.T) {
	withSnapshotDir(t)

	// src/app/core/services/snapshot.service.ts:9-21, the ExportProgress interface.
	want := []string{
		"running", "paused", "totalNamespaces", "completedNamespaces",
		"currentNamespace", "activeResources", "fileCount", "etaSeconds",
		"elapsedSeconds", "error", "snapshotContext", "currentContext",
	}
	got := progress(t)
	for _, k := range want {
		if _, ok := got[k]; !ok {
			t.Errorf("response is missing %q — the frontend reads it from both backends", k)
		}
	}
}

// Starting a fresh export over a finished snapshot used to report the previous
// run's file count until the exporter got around to deleting the directory, so
// the progress bar opened at 100%.
func TestFreshStartSuppressesThePreviousRunsCounts(t *testing.T) {
	withSnapshotDir(t)

	state.mu.Lock()
	state.freshStart = true
	state.mu.Unlock()

	got := progress(t)
	if got["fileCount"] != float64(0) || got["totalNamespaces"] != float64(0) {
		t.Fatalf("fileCount=%v totalNamespaces=%v during a fresh start, want 0 and 0",
			got["fileCount"], got["totalNamespaces"])
	}
}

func TestStopRejectedWhenNothingRunning(t *testing.T) {
	withSnapshotDir(t)

	got, code := post(t, `{"command":"stop"}`)
	if code != http.StatusBadRequest {
		t.Fatalf("stop returned %d, want 400", code)
	}
	if got["error"] != "No export running" {
		t.Errorf("error = %v", got["error"])
	}
}

func TestProgressReportsRecordedContext(t *testing.T) {
	dir := withSnapshotDir(t)
	os.WriteFile(filepath.Join(dir, ".export-context"),
		[]byte(`{"context":"kind-kubelens-demo","startedAt":"2026-08-06T19:15:31Z"}`+"\n"), 0644)

	if got := progress(t); got["snapshotContext"] != "kind-kubelens-demo" {
		t.Fatalf("snapshotContext = %v, want kind-kubelens-demo", got["snapshotContext"])
	}
}

func TestProgressReportsBothContexts(t *testing.T) {
	dir := withSnapshotDir(t)
	os.WriteFile(filepath.Join(dir, ".export-context"), []byte(`{"context":"kind-kubelens-demo"}`+"\n"), 0644)
	live := "arn:aws:eks:ap-northeast-1:000000000000:cluster/staging"
	currentKubectlContext = func() *string { return &live }

	got := progress(t)
	if got["snapshotContext"] != "kind-kubelens-demo" {
		t.Errorf("snapshotContext = %v", got["snapshotContext"])
	}
	if got["currentContext"] != live {
		t.Errorf("currentContext = %v, want %q", got["currentContext"], live)
	}
}

// An old snapshot has no .export-context. Null means unknown, and the panel
// treats unknown differently from mismatched — it must not report a name.
func TestProgressReportsNullContextWhenUnrecorded(t *testing.T) {
	withSnapshotDir(t)

	got := progress(t)
	if got["snapshotContext"] != nil {
		t.Fatalf("snapshotContext = %v, want null", got["snapshotContext"])
	}
}

// The contexts cost a kubectl call, so they are only looked up while paused.
func TestContextsAbsentWhenNotPaused(t *testing.T) {
	dir := withSnapshotDir(t)
	os.WriteFile(filepath.Join(dir, ".export-complete"), []byte("{}\n"), 0644)
	os.WriteFile(filepath.Join(dir, ".export-context"), []byte(`{"context":"kind-kubelens-demo"}`+"\n"), 0644)

	got := progress(t)
	if got["snapshotContext"] != nil || got["currentContext"] != nil {
		t.Fatalf("contexts = %v / %v, want null while not paused", got["snapshotContext"], got["currentContext"])
	}
}

func TestExporterCommandPerMode(t *testing.T) {
	cases := []struct {
		mode     string
		workers  int
		wantCmd  string
		wantArgs []string
	}{
		{"node", 0, "node", []string{"scripts/snapshot-node.js"}},
		{"node", 3, "node", []string{"scripts/snapshot-node.js", "--jobs", "3"}},
		{"workers", 4, "node", []string{"scripts/snapshot-node-workers.js", "--workers", "4"}},
		{"procs", 2, "node", []string{"scripts/snapshot-node-procs.js", "--procs", "2"}},
		{"bash", 0, "bash", []string{"scripts/snapshot-bash.sh"}},
		{"bash-parallel", 8, "bash", []string{"scripts/snapshot-bash.sh", "--jobs", "8"}},
	}
	for _, c := range cases {
		gotCmd, gotArgs, err := exporterCommand(c.mode, c.workers)
		if err != nil {
			t.Errorf("%s: unexpected error %v", c.mode, err)
			continue
		}
		if gotCmd != c.wantCmd {
			t.Errorf("%s: cmd = %q, want %q", c.mode, gotCmd, c.wantCmd)
		}
		if strings.Join(gotArgs, " ") != strings.Join(c.wantArgs, " ") {
			t.Errorf("%s: args = %v, want %v", c.mode, gotArgs, c.wantArgs)
		}
	}
}

// Nothing built the binary in a test run, so this exercises the error branch the
// npm-installed user hits when they pick go without the compiled exporter.
func TestExporterCommandGoWithoutBinary(t *testing.T) {
	dir := t.TempDir()
	prev, _ := os.Getwd()
	os.Chdir(dir)
	t.Cleanup(func() { os.Chdir(prev) })

	if _, _, err := exporterCommand("go", 0); err == nil {
		t.Fatal("want an error naming the build step, got nil")
	}
}
