package routes

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"
)

// exporterMessage reproduces what scripts/snapshot-bash.sh prints, by reading
// the script. The Node side does the same in api/utils/exporter-message.ts.
//
// Both backends used to keep a hand-typed copy of the abort message. When the
// script started naming K8S_SNAPSHOT_PATH instead of K8S_SNAPSHOT_DIR, both
// copies kept the old name and every test stayed green: a copied fixture can
// only catch the formatter losing something it already handled, never the
// exporter changing what it says.
//
// Note that Go's test cache cannot see the script: it lives outside the module,
// so editing the message does not invalidate a cached PASS. `npm run test:go`
// passes -count=1 for that reason.
const exporterScript = "../../../scripts/snapshot-bash.sh"

var (
	shellConst  = regexp.MustCompile(`(?m)^([A-Z_]+)='([^']*)'$`)
	printfLine  = regexp.MustCompile(`^printf\s+"((?:[^"\\]|\\.)*)"\s*(.*)$`)
	printfArg   = regexp.MustCompile(`"\$([A-Za-z_][A-Za-z0-9_]*)"`)
	shellExpand = regexp.MustCompile(`\$\{([A-Z_]+)\}`)
)

// unescapeShell turns bash's escapes into the bytes printf would emit.
func unescapeShell(s string) string {
	return strings.NewReplacer(
		`\033`, "\x1b",
		`\e`, "\x1b",
		`\n`, "\n",
		`\t`, "\t",
	).Replace(s)
}

// statements joins backslash continuations and drops comments and blank lines.
func statements(lines []string) []string {
	var out []string
	pending := ""
	for _, line := range lines {
		body := strings.TrimSpace(line)
		if body == "" || strings.HasPrefix(body, "#") {
			continue
		}
		if strings.HasSuffix(body, `\`) {
			pending += strings.TrimSuffix(body, `\`)
			continue
		}
		out = append(out, strings.TrimSpace(pending+body))
		pending = ""
	}
	if pending != "" {
		out = append(out, strings.TrimSpace(pending))
	}
	return out
}

// exporterMessage renders every printf between `# fixture:<name>:start` and
// `:end`, substituting %s with the caller's values by shell variable name. It
// fails the test rather than returning a half-rendered message.
func exporterMessage(t *testing.T, name string, values map[string]string) string {
	t.Helper()

	raw, err := os.ReadFile(exporterScript)
	if err != nil {
		t.Fatalf("cannot read %s: %v", exporterScript, err)
	}
	script := string(raw)

	consts := map[string]string{}
	for _, m := range shellConst.FindAllStringSubmatch(script, -1) {
		consts[m[1]] = unescapeShell(m[2])
	}

	start := strings.Index(script, fmt.Sprintf("# fixture:%s:start", name))
	end := strings.Index(script, fmt.Sprintf("# fixture:%s:end", name))
	if start < 0 || end < start {
		t.Fatalf("%s has no '# fixture:%s:start/:end' block", exporterScript, name)
	}
	block := strings.Split(script[start:end], "\n")[1:]

	var out strings.Builder
	for _, statement := range statements(block) {
		m := printfLine.FindStringSubmatch(statement)
		if m == nil {
			continue
		}

		var args []string
		for _, a := range printfArg.FindAllStringSubmatch(m[2], -1) {
			args = append(args, a[1])
		}

		text := shellExpand.ReplaceAllStringFunc(m[1], func(whole string) string {
			key := shellExpand.FindStringSubmatch(whole)[1]
			if v, ok := consts[key]; ok {
				return v
			}
			return whole
		})

		arg := 0
		for _, part := range strings.SplitAfter(unescapeShell(text), "%s") {
			if !strings.HasSuffix(part, "%s") {
				out.WriteString(part)
				continue
			}
			out.WriteString(strings.TrimSuffix(part, "%s"))
			if arg >= len(args) {
				t.Fatalf("fixture %s: more %%s than arguments", name)
			}
			v, ok := values[args[arg]]
			if !ok {
				t.Fatalf("fixture %s: no value given for $%s", name, args[arg])
			}
			out.WriteString(v)
			arg++
		}
	}

	if out.Len() == 0 {
		t.Fatalf("fixture %s: block has no printf lines", name)
	}
	return out.String()
}
