package store

import (
	"encoding/json"
	"encoding/base64"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// CommandResult is returned by HandleCommand.
type CommandResult struct {
	Success bool
	Stdout  string
	Error   string
}

// ParsedCommand is the structured form of a kubectl command string.
type ParsedCommand struct {
	Action       string
	SubAction    string
	Resource     string
	ResourceName string
	Namespace    string
	Output       string
	Flags        map[string]interface{}
	Raw          string
}

// resourceFileMap maps kubectl resource aliases to YAML filenames.
var resourceFileMap = map[string]string{
	"deployments": "deployments.yaml", "deployment": "deployments.yaml", "deploy": "deployments.yaml",
	"services": "services.yaml", "service": "services.yaml", "svc": "services.yaml",
	"cronjobs": "cronjobs.yaml", "cronjob": "cronjobs.yaml",
	"jobs": "jobs.yaml", "job": "jobs.yaml",
	"statefulsets": "statefulsets.yaml", "statefulset": "statefulsets.yaml", "sts": "statefulsets.yaml",
	"configmaps": "configmaps.yaml", "configmap": "configmaps.yaml", "cm": "configmaps.yaml",
	"endpoints": "endpoints.yaml", "ep": "endpoints.yaml",
	"secrets": "secrets.yaml", "secret": "secrets.yaml",
	"serviceaccounts": "serviceaccounts.yaml", "serviceaccount": "serviceaccounts.yaml", "sa": "serviceaccounts.yaml",
	"persistentvolumeclaims": "persistentvolumeclaims.yaml", "persistentvolumeclaim": "persistentvolumeclaims.yaml", "pvc": "persistentvolumeclaims.yaml",
	"poddisruptionbudgets": "poddisruptionbudgets.yaml", "poddisruptionbudget": "poddisruptionbudgets.yaml", "pdb": "poddisruptionbudgets.yaml",
	"gateways": "gateways.yaml", "gateway": "gateways.yaml",
	"httproutes": "httproutes.yaml", "httproute": "httproutes.yaml",
	"tcproutes": "tcproutes.yaml", "tcproute": "tcproutes.yaml",
	"roles": "roles.yaml", "role": "roles.yaml",
	"rolebindings": "rolebindings.yaml", "rolebinding": "rolebindings.yaml",
	// nil-mapped (no YAML file)
	"pods": "", "pod": "",
	"namespaces": "", "namespace": "", "ns": "",
	"nodes": "", "node": "",
	"replicasets": "", "replicaset": "", "rs": "",
	"events": "", "event": "", "ev": "",
}

type tableGen func([]K8sItem) string

var tableGenerators = map[string]tableGen{
	"deployments.yaml":  GenerateDeploymentTable,
	"services.yaml":     GenerateServiceTable,
	"cronjobs.yaml":     GenerateCronjobTable,
	"statefulsets.yaml": GenerateStatefulsetTable,
	"jobs.yaml":         GenerateJobTable,
	"configmaps.yaml":   GenerateConfigmapTable,
	"endpoints.yaml":    GenerateEndpointTable,
}

// ParseKubectlCommand parses a kubectl command string into structured parts.
func ParseKubectlCommand(command string) *ParsedCommand {
	parts := strings.Fields(command)
	if len(parts) == 0 || parts[0] != "kubectl" {
		return nil
	}
	p := &ParsedCommand{Flags: map[string]interface{}{}, Raw: command}
	i := 1
	for i < len(parts) {
		part := parts[i]
		if p.Action == "" {
			p.Action = part
			i++
			continue
		}
		if (p.Action == "rollout" || p.Action == "config" || p.Action == "set") && p.SubAction == "" {
			p.SubAction = part
			i++
			continue
		}
		if part == "-n" || part == "--namespace" {
			if i+1 < len(parts) {
				p.Namespace = strings.Trim(parts[i+1], "'\"")
				i += 2
			} else {
				i++
			}
			continue
		}
		if part == "-o" || part == "--output" {
			if i+1 < len(parts) {
				p.Output = parts[i+1]
				i += 2
			} else {
				i++
			}
			continue
		}
		if strings.HasPrefix(part, "-o") && len(part) > 2 {
			p.Output = part[2:]
			i++
			continue
		}
		if part == "--all-namespaces" || part == "-A" {
			p.Flags["allNamespaces"] = true
			i++
			continue
		}
		if part == "--no-headers" {
			p.Flags["noHeaders"] = true
			i++
			continue
		}
		if part == "--tail" || part == "--timeout" || part == "--revision" ||
			part == "--field-selector" || part == "--sort-by" || part == "-l" ||
			part == "-c" || part == "--image" {
			if i+1 < len(parts) {
				p.Flags[strings.TrimLeft(part, "-")] = parts[i+1]
				i += 2
			} else {
				i++
			}
			continue
		}
		if strings.HasPrefix(part, "--") || strings.HasPrefix(part, "-") {
			if strings.Contains(part, "=") {
				kv := strings.SplitN(part, "=", 2)
				p.Flags[strings.TrimLeft(kv[0], "-")] = kv[1]
			} else {
				p.Flags[strings.TrimLeft(part, "-")] = true
			}
			i++
			continue
		}
		if p.Resource == "" {
			p.Resource = part
		} else if p.ResourceName == "" {
			p.ResourceName = part
		}
		i++
	}
	if p.Resource == "all" {
		p.Flags["getAll"] = true
	}
	return p
}

// HandleCommand dispatches a kubectl command to the appropriate snapshot handler.
func HandleCommand(command string) CommandResult {
	p := ParseKubectlCommand(command)
	if p == nil {
		return CommandResult{Error: "Failed to parse command"}
	}
	switch p.Action {
	case "get":
		return handleGet(p)
	case "describe":
		return handleDescribe(p)
	case "rollout":
		return handleRollout(p)
	case "config":
		return handleConfig(p)
	case "logs":
		return handleLogs(p)
	case "exec":
		return CommandResult{Error: "[SNAPSHOT] exec is not supported in snapshot mode"}
	case "delete":
		return CommandResult{Error: "[SNAPSHOT] delete is not supported in snapshot mode (read-only)"}
	case "set":
		return handleSet(p)
	case "port-forward":
		return CommandResult{Error: "[SNAPSHOT] port-forward is not supported in snapshot mode"}
	case "patch":
		name := p.ResourceName
		if name == "" {
			name = "unknown"
		}
		return CommandResult{Success: true, Stdout: fmt.Sprintf("service/%s patched (snapshot)", name)}
	case "run":
		return CommandResult{Success: true, Stdout: "pod/test-connectivity created (snapshot)\nConnection successful"}
	case "apply":
		return CommandResult{Success: true, Stdout: "resource applied (snapshot)"}
	default:
		return CommandResult{Error: fmt.Sprintf("[SNAPSHOT] Unsupported action: %s", p.Action)}
	}
}

// --- GET ---

func handleGet(p *ParsedCommand) CommandResult {
	if p.Flags["getAll"] == true {
		return handleGetAll(p)
	}
	switch p.Resource {
	case "namespaces", "namespace", "ns":
		return handleGetNamespaces(p)
	case "nodes", "node":
		return handleGetNodes(p)
	case "events", "event", "ev":
		return handleGetEvents(p)
	case "pods", "pod":
		return handleGetPods(p)
	case "replicasets", "replicaset", "rs":
		return handleGetReplicasets(p)
	}

	yamlFile, known := resourceFileMap[p.Resource]
	if !known {
		return CommandResult{Error: fmt.Sprintf("[SNAPSHOT] Unknown resource type: %s", p.Resource)}
	}
	if yamlFile == "" {
		return CommandResult{Error: fmt.Sprintf("[SNAPSHOT] No YAML file for %s", p.Resource)}
	}

	data := LoadYaml(yamlFile, p.Namespace)
	if data == nil {
		return CommandResult{Error: fmt.Sprintf("[SNAPSHOT] No backup data for %s", p.Resource)}
	}

	if p.ResourceName != "" {
		item := FindItem(data, p.ResourceName)
		if item == nil {
			return CommandResult{Error: fmt.Sprintf("Error from server (NotFound): %s %q not found", p.Resource, p.ResourceName)}
		}
		return renderSingleItem(item, p, yamlFile)
	}

	items := data.Items
	if strings.HasPrefix(p.Output, "jsonpath=") {
		return CommandResult{Success: true, Stdout: strings.Join(ExtractNames(data), " ")}
	}
	if p.Output == "json" {
		b, _ := json.MarshalIndent(data, "", "  ")
		return CommandResult{Success: true, Stdout: string(b)}
	}
	if p.Output == "yaml" {
		b, _ := yaml.Marshal(data)
		return CommandResult{Success: true, Stdout: string(b)}
	}
	if strings.HasPrefix(p.Output, "custom-columns=") {
		return handleCustomColumns(p, items)
	}
	if gen, ok := tableGenerators[yamlFile]; ok {
		out := gen(items)
		if p.Flags["noHeaders"] == true {
			lines := strings.SplitN(out, "\n", 2)
			if len(lines) > 1 {
				out = lines[1]
			}
		}
		return CommandResult{Success: true, Stdout: out}
	}
	return CommandResult{Success: true, Stdout: strings.Join(ExtractNames(data), "\n")}
}

func renderSingleItem(item K8sItem, p *ParsedCommand, yamlFile string) CommandResult {
	switch p.Output {
	case "json":
		b, _ := json.MarshalIndent(item, "", "  ")
		return CommandResult{Success: true, Stdout: string(b)}
	case "yaml":
		b, _ := yaml.Marshal(item)
		return CommandResult{Success: true, Stdout: string(b)}
	}
	if strings.HasPrefix(p.Output, "jsonpath=") {
		jp := strings.TrimPrefix(p.Output, "jsonpath=")
		jp = strings.Trim(jp, "\"")
		if jp == "{.data}" {
			if d, ok := item["data"].(map[string]interface{}); ok {
				decoded := map[string]string{}
				for k, v := range d {
					raw := strVal(v)
					if b, err := base64.StdEncoding.DecodeString(raw); err == nil {
						decoded[k] = string(b)
					} else {
						decoded[k] = raw
					}
				}
				b, _ := json.MarshalIndent(decoded, "", "  ")
				return CommandResult{Success: true, Stdout: string(b)}
			}
		}
		path := strings.TrimPrefix(jp, "{.")
		path = strings.TrimSuffix(path, "}")
		val := resolveJSONPath(item, path)
		s := fmt.Sprintf("%v", val)
		return CommandResult{Success: true, Stdout: s}
	}
	if gen, ok := tableGenerators[yamlFile]; ok {
		return CommandResult{Success: true, Stdout: gen([]K8sItem{item})}
	}
	b, _ := yaml.Marshal(item)
	return CommandResult{Success: true, Stdout: string(b)}
}

func handleGetNamespaces(p *ParsedCommand) CommandResult {
	namespaces := ListBackupNamespaces()
	if strings.HasPrefix(p.Output, "jsonpath=") {
		return CommandResult{Success: true, Stdout: strings.Join(namespaces, " ")}
	}
	if p.Output == "json" {
		items := make([]map[string]interface{}, len(namespaces))
		for i, ns := range namespaces {
			items[i] = map[string]interface{}{"metadata": map[string]string{"name": ns}, "status": map[string]string{"phase": "Active"}}
		}
		b, _ := json.MarshalIndent(map[string]interface{}{"apiVersion": "v1", "kind": "NamespaceList", "items": items}, "", "  ")
		return CommandResult{Success: true, Stdout: string(b)}
	}
	header := "NAME                    STATUS   AGE"
	rows := make([]string, len(namespaces))
	for i, ns := range namespaces {
		rows[i] = Pad(ns, 24) + "Active   200d"
	}
	out := strings.Join(append([]string{header}, rows...), "\n")
	if p.Flags["noHeaders"] == true {
		out = strings.Join(rows, "\n")
	}
	return CommandResult{Success: true, Stdout: out}
}

func handleGetNodes(p *ParsedCommand) CommandResult {
	type node struct{ name, status, roles, age, version, ip string }
	nodes := []node{
		{"ip-10-0-1-50.ec2.internal", "Ready", "<none>", "365d", "v1.29.3-eks-ae9a62a", "10.0.1.50"},
		{"ip-10-0-2-80.ec2.internal", "Ready", "<none>", "200d", "v1.29.3-eks-ae9a62a", "10.0.2.80"},
	}
	if p.Output == "wide" {
		header := "NAME                                STATUS   ROLES    AGE    VERSION                  INTERNAL-IP      EXTERNAL-IP   OS-IMAGE         KERNEL-VERSION                       CONTAINER-RUNTIME"
		rows := make([]string, len(nodes))
		for i, n := range nodes {
			rows[i] = Pad(n.name, 36) + Pad(n.status, 9) + Pad(n.roles, 9) + Pad(n.age, 7) + Pad(n.version, 25) + Pad(n.ip, 17) + "<none>           Amazon Linux 2   5.10.219-208.866.amzn2.aarch64      containerd://1.7.11"
		}
		return CommandResult{Success: true, Stdout: strings.Join(append([]string{header}, rows...), "\n")}
	}
	header := "NAME                                STATUS   ROLES    AGE    VERSION"
	rows := make([]string, len(nodes))
	for i, n := range nodes {
		rows[i] = Pad(n.name, 36) + Pad(n.status, 9) + Pad(n.roles, 9) + Pad(n.age, 7) + n.version
	}
	out := strings.Join(append([]string{header}, rows...), "\n")
	if p.Flags["noHeaders"] == true {
		out = strings.Join(rows, "\n")
	}
	return CommandResult{Success: true, Stdout: out}
}

func handleGetEvents(_ *ParsedCommand) CommandResult {
	return CommandResult{Success: true, Stdout: strings.Join([]string{
		"LAST SEEN   TYPE      REASON              OBJECT                                        MESSAGE",
		"3m          Normal    Scheduled           pod/web-app-7449d97884-j7bt5                    Successfully assigned demo/web-app-7449d97884-j7bt5 to ip-10-0-2-80.ec2.internal",
		"3m          Normal    Pulled              pod/web-app-7449d97884-j7bt5                    Container image already present on machine",
		"3m          Normal    Started             pod/web-app-7449d97884-j7bt5                    Started container web-app",
		"10h         Normal    ScalingReplicaSet   deployment/web-app                              Scaled up replica set web-app-7449d97884 to 1",
		"23h         Warning   BackOff             pod/converter-86565f7d48-2v46j            Back-off restarting failed container",
	}, "\n")}
}

func handleGetPods(p *ParsedCommand) CommandResult {
	ns := p.Namespace
	snapshot := LoadText("pods-snapshot.txt", ns)
	images := LoadText("pods-images.txt", ns)

	if snapshot == "" {
		if strings.HasPrefix(p.Output, "jsonpath=") {
			return CommandResult{Success: true, Stdout: ""}
		}
		return CommandResult{Success: true, Stdout: "No resources found in namespace."}
	}

	lines := strings.Split(strings.TrimSpace(snapshot), "\n")
	header := lines[0]
	dataLines := lines[1:]

	if p.ResourceName != "" {
		var podLine string
		for _, l := range dataLines {
			if strings.HasPrefix(strings.TrimSpace(l), p.ResourceName) {
				podLine = l
				break
			}
		}
		if podLine == "" {
			return CommandResult{Error: fmt.Sprintf("Error from server (NotFound): pods %q not found", p.ResourceName)}
		}
		switch p.Output {
		case "json":
			b, _ := json.MarshalIndent(buildPodJSON(podLine, ns, images), "", "  ")
			return CommandResult{Success: true, Stdout: string(b)}
		case "yaml":
			b, _ := yaml.Marshal(buildPodJSON(podLine, ns, images))
			return CommandResult{Success: true, Stdout: string(b)}
		}
		if p.Flags["noHeaders"] == true {
			return CommandResult{Success: true, Stdout: podLine}
		}
		return CommandResult{Success: true, Stdout: header + "\n" + podLine}
	}

	if strings.HasPrefix(p.Output, "jsonpath=") {
		var names []string
		for _, l := range dataLines {
			parts := strings.Fields(l)
			if len(parts) > 0 {
				names = append(names, parts[0])
			}
		}
		return CommandResult{Success: true, Stdout: strings.Join(names, " ")}
	}

	if strings.HasPrefix(p.Output, "custom-columns=") && images != "" &&
		(strings.Contains(p.Output, "IMAGE") || strings.Contains(p.Output, "image")) {
		out := strings.TrimSpace(images)
		if p.Flags["noHeaders"] == true {
			parts := strings.SplitN(out, "\n", 2)
			if len(parts) > 1 {
				out = parts[1]
			}
		}
		return CommandResult{Success: true, Stdout: out}
	}

	out := strings.TrimSpace(snapshot)
	if p.Flags["noHeaders"] == true {
		out = strings.Join(dataLines, "\n")
	}
	return CommandResult{Success: true, Stdout: out}
}

func buildPodJSON(podLine, ns, images string) map[string]interface{} {
	parts := strings.Fields(podLine)
	get := func(i int) string {
		if i < len(parts) {
			return parts[i]
		}
		return ""
	}
	podName := get(0)
	if ns == "" {
		ns = DefaultNamespace
	}
	result := map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Pod",
		"metadata":   map[string]string{"name": podName, "namespace": ns},
		"status": map[string]interface{}{
			"phase":  get(2),
			"podIP":  get(5),
			"hostIP": get(6),
			"containerStatuses": []map[string]interface{}{{
				"name":         "main",
				"ready":        get(1) == "1/1",
				"restartCount": 0,
			}},
		},
	}
	if images != "" {
		for _, l := range strings.Split(strings.TrimSpace(images), "\n") {
			if strings.HasPrefix(strings.TrimSpace(l), podName) {
				imgStr := strings.Join(strings.Fields(l)[1:], " ")
				imgs := strings.Split(imgStr, ",")
				containers := make([]map[string]interface{}, len(imgs))
				for i, img := range imgs {
					name := "main"
					if i > 0 {
						name = fmt.Sprintf("sidecar-%d", i)
					}
					containers[i] = map[string]interface{}{"name": name, "image": strings.TrimSpace(img)}
				}
				result["spec"] = map[string]interface{}{"containers": containers}
				break
			}
		}
	}
	return result
}

func handleGetReplicasets(p *ParsedCommand) CommandResult {
	data := LoadYaml("deployments.yaml", p.Namespace)
	if data == nil {
		return CommandResult{Success: true, Stdout: "No resources found."}
	}
	if strings.HasPrefix(p.Output, "jsonpath=") {
		var names []string
		for _, d := range data.Items {
			meta := ItemMeta(d)
			names = append(names, fmt.Sprintf("%s-%v", ItemName(d), meta["generation"]))
		}
		return CommandResult{Success: true, Stdout: strings.Join(names, " ")}
	}
	header := "NAME                                          DESIRED   CURRENT   READY   AGE"
	rows := make([]string, len(data.Items))
	for i, d := range data.Items {
		spec := ItemSpec(d)
		status := ItemStatus(d)
		meta := ItemMeta(d)
		rsName := fmt.Sprintf("%s-%02v", ItemName(d), meta["generation"])
		desired := intVal(spec["replicas"])
		if desired == 0 {
			desired = 1
		}
		rows[i] = Pad(rsName, 46) + Pad(fmt.Sprintf("%d", desired), 10) + Pad(fmt.Sprintf("%v", status["replicas"]), 10) + Pad(fmt.Sprintf("%v", status["readyReplicas"]), 8) + GetAge(ItemCreationTimestamp(d))
	}
	out := strings.Join(append([]string{header}, rows...), "\n")
	if p.Flags["noHeaders"] == true {
		out = strings.Join(rows, "\n")
	}
	return CommandResult{Success: true, Stdout: out}
}

func handleGetAll(p *ParsedCommand) CommandResult {
	ns := p.Namespace
	if ns == "" {
		ns = DefaultNamespace
	}
	var parts []string

	if snapshot := LoadText("pods-snapshot.txt", ns); snapshot != "" {
		lines := strings.Split(strings.TrimSpace(snapshot), "\n")
		header := lines[0]
		var podLines []string
		for _, l := range lines[1:] {
			f := strings.Fields(l)
			rest := ""
			if len(f) > 1 {
				rest = "   " + strings.Join(f[1:], "   ")
			}
			podLines = append(podLines, "pod/"+f[0]+rest)
		}
		parts = append(parts, "=== POD ===\n"+header+"\n"+strings.Join(podLines, "\n"))
	}
	if d := LoadYaml("deployments.yaml", ns); d != nil {
		parts = append(parts, "=== DEPLOYMENT ===\n"+GenerateDeploymentTable(d.Items))
	}
	if d := LoadYaml("services.yaml", ns); d != nil {
		parts = append(parts, "=== SERVICE ===\n"+GenerateServiceTable(d.Items))
	}
	if d := LoadYaml("statefulsets.yaml", ns); d != nil {
		parts = append(parts, "=== STATEFULSET ===\n"+GenerateStatefulsetTable(d.Items))
	}
	if d := LoadYaml("cronjobs.yaml", ns); d != nil {
		parts = append(parts, "=== CRONJOB ===\n"+GenerateCronjobTable(d.Items))
	}
	if d := LoadYaml("jobs.yaml", ns); d != nil {
		parts = append(parts, "=== JOB ===\n"+GenerateJobTable(d.Items))
	}
	return CommandResult{Success: true, Stdout: strings.Join(parts, "\n\n")}
}

func handleCustomColumns(p *ParsedCommand, items []K8sItem) CommandResult {
	spec := strings.TrimPrefix(p.Output, "custom-columns=")
	spec = strings.Trim(spec, "\"")
	type col struct{ label, path string }
	var cols []col
	for _, c := range strings.Split(spec, ",") {
		parts := strings.SplitN(c, ":", 2)
		if len(parts) == 2 {
			cols = append(cols, col{strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])})
		}
	}
	headerParts := make([]string, len(cols))
	for i, c := range cols {
		headerParts[i] = Pad(c.label, 40)
	}
	header := strings.Join(headerParts, "")
	rows := make([]string, len(items))
	for i, item := range items {
		parts := make([]string, len(cols))
		for j, c := range cols {
			val := resolveJSONPath(item, c.path)
			parts[j] = Pad(fmt.Sprintf("%v", val), 40)
		}
		rows[i] = strings.Join(parts, "")
	}
	out := strings.Join(append([]string{header}, rows...), "\n")
	if p.Flags["noHeaders"] == true {
		out = strings.Join(rows, "\n")
	}
	return CommandResult{Success: true, Stdout: out}
}

func resolveJSONPath(obj interface{}, path string) interface{} {
	if path == "" {
		return ""
	}
	path = strings.TrimPrefix(path, "{.")
	path = strings.TrimSuffix(path, "}")
	path = strings.TrimPrefix(path, ".")
	parts := strings.Split(path, ".")
	current := obj
	for _, part := range parts {
		if current == nil {
			return "<none>"
		}
		if strings.HasSuffix(part, "[*]") {
			key := strings.TrimSuffix(part, "[*]")
			m, _ := current.(map[string]interface{})
			if m == nil {
				return "<none>"
			}
			arr, _ := m[key].([]interface{})
			if arr == nil {
				return "<none>"
			}
			current = arr
			continue
		}
		m, _ := current.(map[string]interface{})
		if m == nil {
			return "<none>"
		}
		current = m[part]
	}
	if current == nil {
		return "<none>"
	}
	return current
}

// --- DESCRIBE ---

func handleDescribe(p *ParsedCommand) CommandResult {
	switch p.Resource {
	case "deployment", "deployments", "deploy":
		data := LoadYaml("deployments.yaml", p.Namespace)
		if data == nil {
			return CommandResult{Error: "No deployment data"}
		}
		if p.ResourceName != "" {
			return CommandResult{Success: true, Stdout: GenerateDeploymentDescribe(FindItem(data, p.ResourceName))}
		}
		var out []string
		for _, item := range data.Items {
			out = append(out, GenerateDeploymentDescribe(item))
		}
		return CommandResult{Success: true, Stdout: strings.Join(out, "\n\n---\n\n")}
	case "pod", "pods":
		if p.ResourceName != "" {
			return CommandResult{Success: true, Stdout: GeneratePodDescribe(p.ResourceName, p.Namespace)}
		}
		snapshot := LoadText("pods-snapshot.txt", p.Namespace)
		if snapshot == "" {
			return CommandResult{Error: "No pod data"}
		}
		lines := strings.Split(strings.TrimSpace(snapshot), "\n")
		var out []string
		for _, l := range lines[1:] {
			parts := strings.Fields(l)
			if len(parts) > 0 {
				out = append(out, GeneratePodDescribe(parts[0], p.Namespace))
			}
		}
		return CommandResult{Success: true, Stdout: strings.Join(out, "\n\n---\n\n")}
	case "service", "services", "svc":
		data := LoadYaml("services.yaml", p.Namespace)
		if data == nil {
			return CommandResult{Error: "No service data"}
		}
		if p.ResourceName != "" {
			return CommandResult{Success: true, Stdout: GenerateServiceDescribe(FindItem(data, p.ResourceName))}
		}
		var out []string
		for _, item := range data.Items {
			out = append(out, GenerateServiceDescribe(item))
		}
		return CommandResult{Success: true, Stdout: strings.Join(out, "\n\n---\n\n")}
	}

	fileMap := map[string]string{
		"secret": "secrets.yaml", "secrets": "secrets.yaml",
		"configmap": "configmaps.yaml", "configmaps": "configmaps.yaml", "cm": "configmaps.yaml",
		"serviceaccount": "serviceaccounts.yaml", "serviceaccounts": "serviceaccounts.yaml", "sa": "serviceaccounts.yaml",
		"statefulset": "statefulsets.yaml", "statefulsets": "statefulsets.yaml", "sts": "statefulsets.yaml",
		"cronjob": "cronjobs.yaml", "cronjobs": "cronjobs.yaml",
		"job": "jobs.yaml", "jobs": "jobs.yaml",
		"persistentvolumeclaim": "persistentvolumeclaims.yaml", "persistentvolumeclaims": "persistentvolumeclaims.yaml", "pvc": "persistentvolumeclaims.yaml",
		"ingress": "ingresses.yaml", "ingresses": "ingresses.yaml",
		"gateway": "gateways.yaml", "gateways": "gateways.yaml",
		"httproute": "httproutes.yaml", "httproutes": "httproutes.yaml",
	}
	if f, ok := fileMap[p.Resource]; ok {
		data := LoadYaml(f, p.Namespace)
		if data == nil {
			return CommandResult{Error: fmt.Sprintf("No %s data", p.Resource)}
		}
		items := data.Items
		if p.ResourceName != "" {
			items = nil
			for _, item := range data.Items {
				if ItemName(item) == p.ResourceName {
					items = append(items, item)
				}
			}
		}
		if len(items) == 0 {
			return CommandResult{Error: fmt.Sprintf("Error from server (NotFound): %s %q not found", p.Resource, p.ResourceName)}
		}
		var out []string
		for _, item := range items {
			out = append(out, GenerateGenericDescribe(item))
		}
		return CommandResult{Success: true, Stdout: strings.Join(out, "\n\n---\n\n")}
	}
	return CommandResult{Error: fmt.Sprintf("[SNAPSHOT] describe not implemented for: %s", p.Resource)}
}

// --- ROLLOUT ---

func handleRollout(p *ParsedCommand) CommandResult {
	deployName := p.Resource
	if strings.Contains(deployName, "/") {
		deployName = strings.SplitN(deployName, "/", 2)[1]
	}
	data := LoadYaml("deployments.yaml", p.Namespace)

	switch p.SubAction {
	case "status":
		if data == nil {
			return CommandResult{Success: true, Stdout: fmt.Sprintf("deployment %q successfully rolled out", deployName)}
		}
		item := FindItem(data, deployName)
		if item == nil {
			return CommandResult{Error: fmt.Sprintf("Error from server (NotFound): deployments.apps %q not found", deployName)}
		}
		status := ItemStatus(item)
		spec := ItemSpec(item)
		ready := intVal(status["readyReplicas"])
		desired := intVal(spec["replicas"])
		if desired == 0 {
			desired = 1
		}
		if ready >= desired {
			return CommandResult{Success: true, Stdout: fmt.Sprintf("deployment %q successfully rolled out", deployName)}
		}
		return CommandResult{Success: true, Stdout: fmt.Sprintf("Waiting for deployment %q rollout to finish: %d of %d updated replicas are available...", deployName, ready, desired)}
	case "history":
		return CommandResult{Success: true, Stdout: fmt.Sprintf("deployment.apps/%s\nREVISION  CHANGE-CAUSE\n1         <none>\n2         <none>\n3         kubectl set image deployment/%s %s=image:v2", deployName, deployName, deployName)}
	case "undo":
		return CommandResult{Success: true, Stdout: fmt.Sprintf("deployment.apps/%s rolled back", deployName)}
	case "pause":
		return CommandResult{Success: true, Stdout: fmt.Sprintf("deployment.apps/%s paused", deployName)}
	case "resume":
		return CommandResult{Success: true, Stdout: fmt.Sprintf("deployment.apps/%s resumed", deployName)}
	case "restart":
		return CommandResult{Success: true, Stdout: fmt.Sprintf("deployment.apps/%s restarted", deployName)}
	default:
		return CommandResult{Error: fmt.Sprintf("[SNAPSHOT] Unsupported rollout action: %s", p.SubAction)}
	}
}

// --- CONFIG ---

func handleConfig(p *ParsedCommand) CommandResult {
	switch p.SubAction {
	case "current-context":
		return CommandResult{Success: true, Stdout: "snapshot-context"}
	case "get-contexts":
		return CommandResult{Success: true, Stdout: fmt.Sprintf("CURRENT   NAME                 CLUSTER              AUTHINFO             NAMESPACE\n*         snapshot-context     snapshot-cluster     snapshot-user        %s", DefaultNamespace)}
	default:
		return CommandResult{Error: fmt.Sprintf("[SNAPSHOT] Unsupported config action: %s", p.SubAction)}
	}
}

// --- LOGS ---

func handleLogs(p *ParsedCommand) CommandResult {
	ns := p.Namespace
	if ns == "" {
		ns = DefaultNamespace
	}
	return CommandResult{Success: true, Stdout: fmt.Sprintf("[SNAPSHOT] Log output for pod %s in namespace %s\n2026-02-13T12:00:00Z INFO  Application started\n2026-02-13T12:00:01Z INFO  Listening on port 8080\n2026-02-13T12:00:05Z INFO  Health check passed\n2026-02-13T12:01:00Z INFO  Request received: GET /api/status\n2026-02-13T12:01:00Z INFO  Response sent: 200 OK\n2026-02-13T12:05:00Z INFO  Health check passed", p.Resource, ns)}
}

// --- SET ---

func handleSet(p *ParsedCommand) CommandResult {
	if p.SubAction == "image" {
		res := p.Resource
		if res == "" {
			res = "unknown"
		}
		return CommandResult{Success: true, Stdout: fmt.Sprintf("deployment.apps/%s image updated (snapshot)", res)}
	}
	return CommandResult{Error: fmt.Sprintf("[SNAPSHOT] Unsupported set action: %s", p.SubAction)}
}
