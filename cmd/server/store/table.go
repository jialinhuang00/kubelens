package store

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Config-driven `kubectl get` tables for Snapshot mode, the Go half of
// api/utils/snapshot-parsers.ts. Column layouts live in kubelens.config.yaml's
// `tables:` section; adding a kind is YAML on both backends, not code on either.
//
// Ported because this backend had seven hand-written table functions and no way
// to read that section, so nine kinds came back as a bare list of names and
// editing the config did nothing here. Every transform below exists because the
// TypeScript has one by that name; the pair is checked end to end by
// api/utils/table-parity.itest.ts, which renders the same fixtures through both
// and compares the text.

// accessModeAbbr shortens PVC access modes the way kubectl does.
var accessModeAbbr = map[string]string{
	"ReadWriteOnce": "RWO", "ReadOnlyMany": "ROX", "ReadWriteMany": "RWX", "ReadWriteOncePod": "RWOP",
}

// getPath walks a dotted path (".spec.template.spec.nodeSelector") from an item.
func getPath(obj interface{}, path string) interface{} {
	cur := obj
	for _, p := range strings.Split(strings.TrimPrefix(path, "."), ".") {
		if p == "" {
			continue
		}
		m, ok := cur.(map[string]interface{})
		if !ok {
			return nil
		}
		cur, ok = m[p]
		if !ok {
			return nil
		}
	}
	return cur
}

// scalar renders a resolved value the way JavaScript's String() would, so an
// integer replica count does not come out as "3.000000" on this side only.
func scalar(v interface{}) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
		return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%f", t), "0"), ".")
	case int:
		return fmt.Sprintf("%d", t)
	case int64:
		return fmt.Sprintf("%d", t)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func asSlice(v interface{}) []interface{} {
	if s, ok := v.([]interface{}); ok {
		return s
	}
	return nil
}

func asMap(v interface{}) map[string]interface{} {
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	return nil
}

func arg(args []string, i int, fallback string) string {
	if i < len(args) && args[i] != "" {
		return args[i]
	}
	return fallback
}

// valueTransforms take the resolved field value plus any `:a,b` arguments.
// One that returns "" lets the column's `?fallback` default apply.
var valueTransforms = map[string]func(interface{}, []string) string{
	"age": func(v interface{}, _ []string) string {
		s, _ := v.(string)
		if s == "" {
			return ""
		}
		return GetAge(s)
	},
	"count": func(v interface{}, _ []string) string {
		return fmt.Sprintf("%d", len(asSlice(v)))
	},
	"keys": func(v interface{}, _ []string) string {
		return fmt.Sprintf("%d", len(asMap(v)))
	},
	"join": func(v interface{}, a []string) string {
		sep := arg(a, 0, ",")
		parts := make([]string, 0, len(asSlice(v)))
		for _, e := range asSlice(v) {
			parts = append(parts, scalar(e))
		}
		return strings.Join(parts, sep)
	},
	"bool": func(v interface{}, a []string) string {
		// JavaScript truthiness: "", 0, false, null and absent are all false.
		truthy := false
		switch t := v.(type) {
		case nil:
		case bool:
			truthy = t
		case string:
			truthy = t != ""
		case float64:
			truthy = t != 0
		default:
			truthy = true
		}
		if truthy {
			return arg(a, 0, "True")
		}
		return arg(a, 1, "False")
	},
	"kv": func(v interface{}, _ []string) string {
		m := asMap(v)
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		// Go map iteration is random and JavaScript object order is insertion
		// order. Sorting is the only order both can agree on.
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, k+"="+scalar(m[k]))
		}
		return strings.Join(parts, ",")
	},
	"ports": func(v interface{}, _ []string) string {
		var parts []string
		for _, e := range asSlice(v) {
			p := asMap(e)
			proto := scalar(p["protocol"])
			if proto == "" {
				proto = "TCP"
			}
			if np := scalar(p["nodePort"]); np != "" && np != "0" {
				parts = append(parts, fmt.Sprintf("%s:%s/%s", scalar(p["port"]), np, proto))
			} else {
				parts = append(parts, fmt.Sprintf("%s/%s", scalar(p["port"]), proto))
			}
		}
		return strings.Join(parts, ",")
	},
	"accessModes": func(v interface{}, _ []string) string {
		var parts []string
		for _, e := range asSlice(v) {
			m := scalar(e)
			if abbr, ok := accessModeAbbr[m]; ok {
				m = abbr
			}
			parts = append(parts, m)
		}
		return strings.Join(parts, ",")
	},
	"ref": func(v interface{}, a []string) string {
		r := asMap(v)
		kind := scalar(r["kind"])
		if kind == "" {
			kind = arg(a, 0, "")
		}
		return kind + "/" + scalar(r["name"])
	},
}

// itemTransforms read several fields at once, for columns no single path can
// express. Invoked as `{|name}`.
var itemTransforms = map[string]func(K8sItem) string{
	"jobDuration": func(j K8sItem) string {
		st := asMap(j["status"])
		start, _ := st["startTime"].(string)
		end, _ := st["completionTime"].(string)
		if start == "" || end == "" {
			return "<none>"
		}
		return GetDuration(start, end)
	},
	"endpoints": func(e K8sItem) string {
		var all []string
		total := 0
		for _, s := range asSlice(e["subsets"]) {
			sub := asMap(s)
			for _, a := range asSlice(sub["addresses"]) {
				total++
				addr := asMap(a)
				for _, p := range asSlice(sub["ports"]) {
					all = append(all, fmt.Sprintf("%s:%s", scalar(addr["ip"]), scalar(asMap(p)["port"])))
				}
			}
		}
		if len(all) > 3 {
			all = all[:3]
		}
		out := strings.Join(all, ",")
		if out == "" {
			out = "<none>"
		}
		if total > 3 {
			out += " + more..."
		}
		return out
	},
	"ingressHosts": func(i K8sItem) string {
		var hosts []string
		for _, r := range asSlice(asMap(i["spec"])["rules"]) {
			if h := scalar(asMap(r)["host"]); h != "" {
				hosts = append(hosts, h)
			}
		}
		if len(hosts) == 0 {
			return "*"
		}
		return strings.Join(hosts, ",")
	},
	"ingressAddress": func(i K8sItem) string {
		var addrs []string
		for _, a := range asSlice(asMap(asMap(i["status"])["loadBalancer"])["ingress"]) {
			m := asMap(a)
			v := scalar(m["hostname"])
			if v == "" {
				v = scalar(m["ip"])
			}
			if v != "" {
				addrs = append(addrs, v)
			}
		}
		return strings.Join(addrs, ",")
	},
	"ingressPorts": func(i K8sItem) string {
		if asMap(i["spec"])["tls"] != nil {
			return "80, 443"
		}
		return "80"
	},
	"hpaTargets": func(h K8sItem) string {
		first := func(v interface{}) map[string]interface{} {
			s := asSlice(v)
			if len(s) == 0 {
				return nil
			}
			return asMap(asMap(s[0])["resource"])
		}
		specMetric := first(asMap(h["spec"])["metrics"])
		curMetric := first(asMap(h["status"])["currentMetrics"])

		target := asMap(specMetric["target"])["averageUtilization"]
		if target == nil {
			return "<none>"
		}
		current := "<unknown>"
		if c := asMap(curMetric["current"])["averageUtilization"]; c != nil {
			current = scalar(c) + "%"
		}
		name := scalar(specMetric["name"])
		if name == "" {
			name = "cpu"
		}
		return fmt.Sprintf("%s: %s/%s%%", name, current, scalar(target))
	},
}

var tokenRe = regexp.MustCompile(`\{([^}]*)\}`)

// resolveToken expands one `{...}`: a whole-item transform, or a path with an
// optional `|transform` and an optional `?fallback`.
func resolveToken(token string, item K8sItem) string {
	if strings.HasPrefix(token, "|") {
		name := strings.SplitN(token[1:], ":", 2)[0]
		if fn, ok := itemTransforms[name]; ok {
			return fn(item)
		}
		return ""
	}

	head := token
	def := ""
	hasDef := false
	if q := strings.Index(token, "?"); q >= 0 {
		head, def, hasDef = token[:q], token[q+1:], true
	}

	var result string
	if p := strings.Index(head, "|"); p >= 0 {
		path, t := head[:p], head[p+1:]
		name, argsStr := t, ""
		if c := strings.Index(t, ":"); c >= 0 {
			name, argsStr = t[:c], t[c+1:]
		}
		var args []string
		if argsStr != "" {
			args = strings.Split(argsStr, ",")
		}
		if fn, ok := valueTransforms[name]; ok {
			result = fn(getPath(item, path), args)
		} else {
			result = scalar(getPath(item, path))
		}
	} else {
		result = scalar(getPath(item, head))
	}

	if result == "" && hasDef {
		result = def
	}
	return result
}

func interpolate(template string, item K8sItem) string {
	return tokenRe.ReplaceAllStringFunc(template, func(m string) string {
		return resolveToken(tokenRe.FindStringSubmatch(m)[1], item)
	})
}

// RenderTable builds a kubectl-style table from a column spec. The last column
// is left unpadded, matching real kubectl's trailing AGE column.
func RenderTable(spec TableSpec, items []K8sItem) string {
	cols := spec.Columns
	last := len(cols) - 1

	var header strings.Builder
	for i, c := range cols {
		if i == last {
			header.WriteString(c.Name)
		} else {
			header.WriteString(Pad(c.Name, c.Width))
		}
	}

	lines := []string{header.String()}
	for _, item := range items {
		var row strings.Builder
		for i, c := range cols {
			v := interpolate(c.Value, item)
			if i == last {
				row.WriteString(v)
			} else {
				row.WriteString(Pad(v, c.Width))
			}
		}
		lines = append(lines, row.String())
	}
	return strings.Join(lines, "\n")
}
