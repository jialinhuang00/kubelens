package routes

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"kubelens/server/store"
)

const prodCluster = "arn:aws:eks:ap-northeast-1:000000000000:cluster/prod"

// What snapshot-bash.sh prints when it refuses to mix two clusters, colour and
// all. This is the message the panel used to swallow. Read out of the script
// rather than copied: the copy went stale the moment the script changed which
// environment variable it names, and nothing here went red. See
// exporter_message_test.go.
func crossClusterMessage(t *testing.T) string {
	t.Helper()
	return exporterMessage(t, "cross-cluster-abort", map[string]string{
		"BASE_DIR": "k8s-snapshot",
		"RECORDED": prodCluster,
		"CONTEXT":  "kind-kubelens-demo",
	})
}

func TestFailureMessageCarriesTheExporterReason(t *testing.T) {
	msg := exportFailureMessage(1, crossClusterMessage(t))
	for _, want := range []string{
		"Process exited with code 1",
		"holds a snapshot of arn:aws:eks",
		"kubectl is on kind-kubelens-demo",
		"Nothing was changed",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("message is missing %q\ngot:\n%s", want, msg)
		}
	}
	if strings.Contains(msg, "\x1b[") {
		t.Error("ANSI colour survived into the message the browser renders")
	}
}

func TestFailureMessageFallsBackWithoutStderr(t *testing.T) {
	if got := exportFailureMessage(1, ""); got != "Process exited with code 1" {
		t.Errorf("got %q", got)
	}
	if got := exportFailureMessage(2, "\n\n   \n"); got != "Process exited with code 2" {
		t.Errorf("blank-only stderr: got %q", got)
	}
}

func TestFailureMessageKeepsTheEnd(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 40; i++ {
		b.WriteString("namespace warning line\n")
	}
	b.WriteString("ERROR: the one line that matters\n")

	msg := exportFailureMessage(1, b.String())
	if !strings.Contains(msg, "the one line that matters") {
		t.Errorf("dropped the last line\ngot:\n%s", msg)
	}
	if len(msg) > 800 {
		t.Errorf("message is %d chars — one noisy run would fill the panel", len(msg))
	}
}

// The abort message tells the user which environment variable to set. Both ends
// of that sentence are read from source here — the names out of the script, the
// behaviour out of store.SnapshotDir() — so renaming the variable in one place
// and not the other fails instead of shipping advice that does nothing. The
// same check exists in Node (api/utils/export-failure.spec.ts).
func TestAbortMessageNamesAVariableTheAppHonours(t *testing.T) {
	msg := crossClusterMessage(t)

	seen := map[string]bool{}
	var named []string
	for _, name := range regexp.MustCompile(`K8S_[A-Z_]+`).FindAllString(msg, -1) {
		if !seen[name] {
			seen[name] = true
			named = append(named, name)
		}
	}
	if len(named) == 0 {
		t.Fatal("the abort message names no environment variable at all")
	}

	// Both names are cleared between rounds, so each one has to carry the
	// answer alone. t.Setenv is not enough: it only restores what it set.
	for _, name := range []string{"K8S_SNAPSHOT_PATH", "K8S_SNAPSHOT_DIR"} {
		t.Setenv(name, "")
		os.Unsetenv(name)
	}

	const want = "/tmp/kubelens-abort-advice"
	for _, name := range named {
		os.Unsetenv("K8S_SNAPSHOT_PATH")
		os.Unsetenv("K8S_SNAPSHOT_DIR")
		os.Setenv(name, want)
		if got := store.SnapshotDir(); got != want {
			t.Errorf("snapshot-bash.sh tells the user to set %s, but store.SnapshotDir() returned %q", name, got)
		}
	}
}
