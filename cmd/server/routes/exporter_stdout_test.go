package routes

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Real stdout from each exporter, captured by scripts/capture-exporter-output.sh
// against a live cluster. The Node suite reads these same files
// (api/utils/exporter-stdout.fixture.ts), so the two hand-written parsers are
// checked against one shared sample rather than against a sample each.
//
// Both parsers were wrong about this format and both suites were green, because
// the samples they were fed had been typed from the same wrong belief. The Go
// patterns matched nothing at all: `dev:go` ran an export with no current
// namespace and no resource line in the panel.
//
// Note that Go's test cache cannot see these files: they live outside the
// module, so recapturing does not invalidate a cached PASS. `npm run test:go`
// passes -count=1 for that reason.
const fixtureDir = "../../../test-fixtures/exporter-stdout"

var exporterModes = []string{"bash", "node", "workers", "procs", "go"}

func exporterStdout(t *testing.T, mode string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(fixtureDir, mode+".txt"))
	if err != nil {
		t.Fatalf("no captured output for the %q exporter: %v\n"+
			"Run: bash scripts/capture-exporter-output.sh   (needs a cluster and a Go toolchain)", mode, err)
	}
	return stripANSI(string(b))
}

// midRun cuts the output where the panel would be polling: after work has
// started, before it finishes. Feeding the whole run and demanding a non-empty
// set would be wrong — by the last line everything is completed, and empty is
// the right answer.
func midRun(t *testing.T, mode string, stopBefore string) string {
	t.Helper()
	text := exporterStdout(t, mode)
	cut := strings.Index(text, stopBefore)
	if cut < 0 {
		t.Fatalf("%s's output never contained %q", mode, stopBefore)
	}
	return text[:cut]
}

func freshState() *exportState {
	return &exportState{
		activeNamespaces: map[string]struct{}{},
		activeResources:  map[string]struct{}{},
	}
}

func TestProgressParsingFollowsEveryExporter(t *testing.T) {
	for _, mode := range exporterModes {
		t.Run(mode+" namespace", func(t *testing.T) {
			s := freshState()
			applyProgressChunk(s, midRun(t, mode, "✓ Namespace"))

			var got []string
			for ns := range s.activeNamespaces {
				got = append(got, ns)
			}
			sort.Strings(got)
			if len(got) != 1 || got[0] != "demo" {
				t.Errorf("activeNamespaces = %v, want [demo] — the panel's current namespace stays blank", got)
			}
		})

		t.Run(mode+" resources", func(t *testing.T) {
			s := freshState()
			applyProgressChunk(s, midRun(t, mode, "←"))

			if len(s.activeResources) == 0 {
				t.Errorf("no resource was ever marked active from %s's output", mode)
			}
		})
	}
}

// The fixture set is only as good as its coverage: an exporter the route can
// spawn with no captured output would pass by not being tested. The script names
// are read out of exporterCommand rather than listed here.
func TestEveryExporterTheRouteSpawnsHasCapturedOutput(t *testing.T) {
	src, err := os.ReadFile("k8s_export.go")
	if err != nil {
		t.Fatalf("cannot read k8s_export.go: %v", err)
	}

	scriptToFixture := map[string]string{
		"snapshot-bash.sh":         "bash",
		"snapshot-node.js":         "node",
		"snapshot-node-workers.js": "workers",
		"snapshot-node-procs.js":   "procs",
		"k8s-export":               "go",
	}

	re := regexp.MustCompile(`"(snapshot-[a-z0-9-]+\.(?:js|sh)|k8s-export)"`)
	found := re.FindAllStringSubmatch(string(src), -1)
	if len(found) == 0 {
		t.Fatal("found no exporter scripts in k8s_export.go — the pattern went stale")
	}

	for _, m := range found {
		fixture, ok := scriptToFixture[m[1]]
		if !ok {
			t.Errorf("the route spawns %s, which has no entry in scriptToFixture", m[1])
			continue
		}
		if _, err := os.Stat(filepath.Join(fixtureDir, fixture+".txt")); err != nil {
			t.Errorf("the route spawns %s but %s.txt is missing", m[1], fixture)
		}
	}
}
