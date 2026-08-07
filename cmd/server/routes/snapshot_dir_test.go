package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kubelens/server/store"
)

// The three places the Go backend touches the snapshot directory used to hold
// three separate answers: this route had a bare "k8s-snapshot", the ping handler
// had its own literal, and only the loader read K8S_SNAPSHOT_PATH. Set that
// variable and an export wrote one directory, the ping checked a second, and
// Snapshot mode read a third — every one of them reporting success.
//
// This test compares them against each other rather than each against an
// expected string. A future change that moves all three together stays green; a
// change that moves one does not.
func TestSnapshotDirIsTheSameForEveryCaller(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("K8S_SNAPSHOT_PATH", dir)

	// The export route's path.
	fromExport := snapshotDir()
	// The loader's, used by Snapshot mode and the graph builder.
	fromLoader := store.SnapshotDir()

	if fromExport != fromLoader {
		t.Fatalf("export route resolves %q, loader resolves %q", fromExport, fromLoader)
	}
	if fromExport != dir {
		t.Fatalf("resolved %q, want the directory K8S_SNAPSHOT_PATH names (%q)", fromExport, dir)
	}
}

// handleSnapshotPing lives in status.go and had a hardcoded path. It reports on
// `.export-complete`, so write one where the export route would and ask it.
func TestSnapshotPingLooksWhereTheExportWrites(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("K8S_SNAPSHOT_PATH", dir)

	if err := os.WriteFile(filepath.Join(snapshotDir(), ".export-complete"), []byte("{}\n"), 0644); err != nil {
		t.Fatal(err)
	}

	if got := pingAvailable(t); got != true {
		t.Fatalf("available = %v after writing a marker where the export route resolves", got)
	}

	os.Remove(filepath.Join(snapshotDir(), ".export-complete"))
	if got := pingAvailable(t); got != false {
		t.Fatalf("available = %v after removing that marker", got)
	}
}

func TestSnapshotDirFallsBackToTheWorkingDirectory(t *testing.T) {
	t.Setenv("K8S_SNAPSHOT_PATH", "")
	t.Setenv("K8S_SNAPSHOT_DIR", "")

	if got := store.SnapshotDir(); got != "k8s-snapshot" {
		t.Fatalf("SnapshotDir() = %q with no environment set, want the cwd-relative default", got)
	}
}

// K8S_SNAPSHOT_DIR is the exporters' older name, and the one the cross-cluster
// abort message used to tell users to set. Reading it here keeps this backend on
// the same directory as the exporters when only that name is set. Mirrored by
// "also honours the exporters' K8S_SNAPSHOT_DIR" in api/utils/paths.spec.ts —
// this side had the case and that side did not, which is how the same variable
// came to relocate the snapshot here and do nothing there.
func TestSnapshotDirAcceptsTheExporterVariable(t *testing.T) {
	t.Setenv("K8S_SNAPSHOT_PATH", "")
	t.Setenv("K8S_SNAPSHOT_DIR", "/data/mysnap")

	if got := store.SnapshotDir(); got != "/data/mysnap" {
		t.Fatalf("SnapshotDir() = %q, want /data/mysnap", got)
	}
}

// The two names once had opposite precedence: PATH first here, DIR first in all
// five exporters. Set both and this route read one directory while the export
// wrote the other.
func TestSnapshotPathWinsOverSnapshotDir(t *testing.T) {
	t.Setenv("K8S_SNAPSHOT_PATH", "/data/a")
	t.Setenv("K8S_SNAPSHOT_DIR", "/data/b")

	if got := store.SnapshotDir(); got != "/data/a" {
		t.Fatalf("SnapshotDir() = %q with both set, want /data/a", got)
	}
	if got := snapshotDir(); got != "/data/a" {
		t.Fatalf("export route resolves %q with both set, want /data/a", got)
	}
}

// The child must be told where to write, under the winning name, with the older
// one removed so nothing the user left set can outrank it.
func TestChildEnvPinsTheResolvedDirectory(t *testing.T) {
	t.Setenv("K8S_SNAPSHOT_PATH", "/data/a")
	t.Setenv("K8S_SNAPSHOT_DIR", "/data/b")

	var sawPath, sawDir int
	var pathValue string
	for _, kv := range childEnv("/data/resolved") {
		switch {
		case strings.HasPrefix(kv, "K8S_SNAPSHOT_PATH="):
			sawPath++
			pathValue = strings.TrimPrefix(kv, "K8S_SNAPSHOT_PATH=")
		case strings.HasPrefix(kv, "K8S_SNAPSHOT_DIR="):
			sawDir++
		}
	}
	if sawPath != 1 || pathValue != "/data/resolved" {
		t.Errorf("K8S_SNAPSHOT_PATH appears %d time(s) as %q, want once as /data/resolved", sawPath, pathValue)
	}
	if sawDir != 0 {
		t.Errorf("K8S_SNAPSHOT_DIR still present %d time(s); a stale value could outrank the resolved one", sawDir)
	}
}

// pingAvailable drives GET /api/snapshot/ping and returns its `available` flag.
func pingAvailable(t *testing.T) bool {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/snapshot/ping", nil)
	rec := httptest.NewRecorder()
	handleSnapshotPing(rec, req)
	var out map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("ping returned %q: %v", rec.Body.String(), err)
	}
	return out["available"]
}
