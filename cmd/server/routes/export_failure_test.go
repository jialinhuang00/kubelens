package routes

import (
	"strings"
	"testing"
)

// What snapshot-bash.sh prints when it refuses to mix two clusters, colour and
// all. This is the message the panel used to swallow.
const crossCluster = "\n\x1b[31mERROR: k8s-snapshot holds a snapshot of arn:aws:eks:ap-northeast-1:000000000000:cluster/prod, and kubectl is on kind-kubelens-demo.\x1b[0m\n" +
	"Adding namespaces from a second cluster would leave both in one directory.\n" +
	"Nothing was changed. Switch context back to arn:aws:eks:ap-northeast-1:000000000000:cluster/prod to continue this snapshot,\n" +
	"run a full export to replace it, or set K8S_SNAPSHOT_DIR to a different path.\n"

func TestFailureMessageCarriesTheExporterReason(t *testing.T) {
	msg := exportFailureMessage(1, crossCluster)
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
