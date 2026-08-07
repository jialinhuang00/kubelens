package routes

import (
	"fmt"
	"regexp"
	"strings"
)

// Mirrors api/utils/export-failure.ts. Both backends feed the same `error`
// string to the same panel, so they have to trim the same way.
const (
	failureMaxLines = 6
	failureMaxChars = 600
)

var failureNoise = []*regexp.Regexp{
	regexp.MustCompile(`^\s*$`),
	regexp.MustCompile(`^\s*at\s`),     // stack frames
	regexp.MustCompile(`^\s*\.\.\.\s`), // truncated frame lists
	regexp.MustCompile(`^node:internal/`),
	regexp.MustCompile(`^Node\.js v`),
}

// exportFailureMessage turns a non-zero exit into something worth reading.
//
// The exporters already explain themselves. Refusing a cross-cluster resume
// prints three lines naming both clusters and three ways forward — but on
// stderr, and the only thing the UI renders is `error`. Without this the panel
// says "Export failed: Process exited with code 1" while the sentence that would
// have told you what to do sits in the server's terminal.
func exportFailureMessage(exitCode int, stderr string) string {
	fallback := fmt.Sprintf("Process exited with code %d", exitCode)
	if stderr == "" {
		return fallback
	}

	var lines []string
	for _, l := range strings.Split(stripANSI(stderr), "\n") {
		l = strings.TrimRight(l, " \t\r")
		noise := false
		for _, re := range failureNoise {
			if re.MatchString(l) {
				noise = true
				break
			}
		}
		if !noise {
			lines = append(lines, l)
		}
	}
	if len(lines) == 0 {
		return fallback
	}

	// The last lines are about this failure; anything earlier is progress output
	// from namespaces that finished before it.
	if len(lines) > failureMaxLines {
		lines = lines[len(lines)-failureMaxLines:]
	}
	tail := strings.Join(lines, "\n")
	if len(tail) > failureMaxChars {
		tail = "…" + tail[len(tail)-failureMaxChars:]
	}
	return fallback + "\n" + tail
}
