package store

import (
	"fmt"
	"strings"
	"time"
)

// --- Helpers ---

// Pad right-pads s to length n with spaces.
func Pad(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return s + strings.Repeat(" ", n-len(s))
}

// GetAge returns a human-readable age from an ISO 8601 timestamp.
func GetAge(timestamp string) string {
	if timestamp == "" {
		return "<unknown>"
	}
	t, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		return "<unknown>"
	}
	diff := time.Since(t)
	if d := int(diff.Hours() / 24); d > 0 {
		return fmt.Sprintf("%dd", d)
	}
	if h := int(diff.Hours()); h > 0 {
		return fmt.Sprintf("%dh", h)
	}
	return fmt.Sprintf("%dm", int(diff.Minutes()))
}

// GetDuration returns human-readable duration between two ISO 8601 timestamps.
func GetDuration(start, end string) string {
	s, err1 := time.Parse(time.RFC3339, start)
	e, err2 := time.Parse(time.RFC3339, end)
	if err1 != nil || err2 != nil {
		return "<none>"
	}
	diff := e.Sub(s)
	secs := int(diff.Seconds())
	if secs < 60 {
		return fmt.Sprintf("%ds", secs)
	}
	mins := secs / 60
	if mins < 60 {
		return fmt.Sprintf("%dm%ds", mins, secs%60)
	}
	return fmt.Sprintf("%dh%dm", mins/60, mins%60)
}

// ExtractNames returns all metadata.name values from a K8sList.
func ExtractNames(list *K8sList) []string {
	if list == nil {
		return nil
	}
	names := make([]string, 0, len(list.Items))
	for _, item := range list.Items {
		if n := ItemName(item); n != "" {
			names = append(names, n)
		}
	}
	return names
}

// FindItem finds a single item by name in a K8sList.
func FindItem(list *K8sList, name string) K8sItem {
	if list == nil {
		return nil
	}
	for _, item := range list.Items {
		if ItemName(item) == name {
			return item
		}
	}
	return nil
}

// --- Table generators ---

func GenerateDeploymentTable(items []K8sItem) string {
	header := "NAME                                  READY   UP-TO-DATE   AVAILABLE   AGE"
	rows := make([]string, 0, len(items))
	for _, d := range items {
		spec := ItemSpec(d)
		status := ItemStatus(d)
		desired := intVal(spec["replicas"])
		if desired == 0 {
			desired = 1
		}
		ready := intVal(status["readyReplicas"])
		upToDate := intVal(status["updatedReplicas"])
		available := intVal(status["availableReplicas"])
		age := GetAge(ItemCreationTimestamp(d))
		rows = append(rows, Pad(ItemName(d), 38)+Pad(fmt.Sprintf("%d/%d", ready, desired), 8)+Pad(fmt.Sprintf("%d", upToDate), 13)+Pad(fmt.Sprintf("%d", available), 12)+age)
	}
	return strings.Join(append([]string{header}, rows...), "\n")
}

func GenerateServiceTable(items []K8sItem) string {
	header := "NAME                            TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)                      AGE"
	rows := make([]string, 0, len(items))
	for _, s := range items {
		spec := ItemSpec(s)
		svcType := strVal(spec["type"])
		if svcType == "" {
			svcType = "ClusterIP"
		}
		clusterIP := strVal(spec["clusterIP"])
		if clusterIP == "" {
			clusterIP = "<none>"
		}
		extIPs := sliceOf(spec["externalIPs"])
		externalIP := "<none>"
		if len(extIPs) > 0 {
			parts := make([]string, 0, len(extIPs))
			for _, ip := range extIPs {
				parts = append(parts, strVal(ip))
			}
			externalIP = strings.Join(parts, ",")
		}
		portParts := []string{}
		for _, p := range sliceOf(spec["ports"]) {
			pm, _ := p.(map[string]interface{})
			if pm == nil {
				continue
			}
			port := intVal(pm["port"])
			proto := strVal(pm["protocol"])
			if proto == "" {
				proto = "TCP"
			}
			if np := intVal(pm["nodePort"]); np != 0 {
				portParts = append(portParts, fmt.Sprintf("%d:%d/%s", port, np, proto))
			} else {
				portParts = append(portParts, fmt.Sprintf("%d/%s", port, proto))
			}
		}
		ports := strings.Join(portParts, ",")
		if ports == "" {
			ports = "<none>"
		}
		age := GetAge(ItemCreationTimestamp(s))
		rows = append(rows, Pad(ItemName(s), 32)+Pad(svcType, 12)+Pad(clusterIP, 17)+Pad(externalIP, 14)+Pad(ports, 29)+age)
	}
	return strings.Join(append([]string{header}, rows...), "\n")
}

func GenerateCronjobTable(items []K8sItem) string {
	header := "NAME                           SCHEDULE       SUSPEND   ACTIVE   LAST SCHEDULE   AGE"
	rows := make([]string, 0, len(items))
	for _, c := range items {
		spec := ItemSpec(c)
		status := ItemStatus(c)
		schedule := strVal(spec["schedule"])
		if schedule == "" {
			schedule = "* * * * *"
		}
		suspend := "False"
		if b, ok := spec["suspend"].(bool); ok && b {
			suspend = "True"
		}
		active := len(sliceOf(status["active"]))
		lastSchedule := "<none>"
		if ls := strVal(status["lastScheduleTime"]); ls != "" {
			lastSchedule = GetAge(ls)
		}
		age := GetAge(ItemCreationTimestamp(c))
		rows = append(rows, Pad(ItemName(c), 31)+Pad(schedule, 15)+Pad(suspend, 10)+Pad(fmt.Sprintf("%d", active), 9)+Pad(lastSchedule, 16)+age)
	}
	return strings.Join(append([]string{header}, rows...), "\n")
}

func GenerateStatefulsetTable(items []K8sItem) string {
	header := "NAME                  READY   AGE"
	rows := make([]string, 0, len(items))
	for _, s := range items {
		spec := ItemSpec(s)
		status := ItemStatus(s)
		desired := intVal(spec["replicas"])
		if desired == 0 {
			desired = 1
		}
		ready := intVal(status["readyReplicas"])
		age := GetAge(ItemCreationTimestamp(s))
		rows = append(rows, Pad(ItemName(s), 22)+Pad(fmt.Sprintf("%d/%d", ready, desired), 8)+age)
	}
	return strings.Join(append([]string{header}, rows...), "\n")
}

func GenerateJobTable(items []K8sItem) string {
	header := "NAME                               COMPLETIONS   DURATION   AGE"
	rows := make([]string, 0, len(items))
	for _, j := range items {
		spec := ItemSpec(j)
		status := ItemStatus(j)
		succeeded := intVal(status["succeeded"])
		completions := intVal(spec["completions"])
		if completions == 0 {
			completions = 1
		}
		duration := "<none>"
		if st := strVal(status["startTime"]); st != "" {
			if ct := strVal(status["completionTime"]); ct != "" {
				duration = GetDuration(st, ct)
			}
		}
		age := GetAge(ItemCreationTimestamp(j))
		rows = append(rows, Pad(ItemName(j), 35)+Pad(fmt.Sprintf("%d/%d", succeeded, completions), 14)+Pad(duration, 11)+age)
	}
	return strings.Join(append([]string{header}, rows...), "\n")
}

func GenerateConfigmapTable(items []K8sItem) string {
	header := "NAME                              DATA   AGE"
	rows := make([]string, 0, len(items))
	for _, c := range items {
		dataCount := 0
		if d, ok := c["data"].(map[string]interface{}); ok {
			dataCount = len(d)
		}
		age := GetAge(ItemCreationTimestamp(c))
		rows = append(rows, Pad(ItemName(c), 34)+Pad(fmt.Sprintf("%d", dataCount), 7)+age)
	}
	return strings.Join(append([]string{header}, rows...), "\n")
}

func GenerateEndpointTable(items []K8sItem) string {
	header := "NAME                            ENDPOINTS                          AGE"
	rows := make([]string, 0, len(items))
	for _, e := range items {
		var eps []string
		totalAddrs := 0
		for _, subset := range sliceOf(e["subsets"]) {
			sm, _ := subset.(map[string]interface{})
			if sm == nil {
				continue
			}
			addrs := sliceOf(sm["addresses"])
			ports := sliceOf(sm["ports"])
			totalAddrs += len(addrs)
			for _, addr := range addrs {
				am, _ := addr.(map[string]interface{})
				if am == nil {
					continue
				}
				ip := strVal(am["ip"])
				for _, port := range ports {
					pm, _ := port.(map[string]interface{})
					if pm == nil {
						continue
					}
					eps = append(eps, fmt.Sprintf("%s:%d", ip, intVal(pm["port"])))
				}
			}
		}
		endpointStr := "<none>"
		if len(eps) > 0 {
			shown := eps
			if len(shown) > 3 {
				shown = shown[:3]
			}
			endpointStr = strings.Join(shown, ",")
			if totalAddrs > 3 {
				endpointStr += " + more..."
			}
		}
		age := GetAge(ItemCreationTimestamp(e))
		rows = append(rows, Pad(ItemName(e), 32)+Pad(endpointStr, 35)+age)
	}
	return strings.Join(append([]string{header}, rows...), "\n")
}

// --- Describe generators ---

func GenerateDeploymentDescribe(item K8sItem) string {
	if item == nil {
		return "Error from server (NotFound): deployments.apps not found"
	}
	m := ItemMeta(item)
	spec := ItemSpec(item)
	status := ItemStatus(item)

	labels := formatKV(ItemLabels(item), "                   ")
	annotations := formatKVStr(ItemAnnotations(item), "                   ")

	template, _ := spec["template"].(map[string]interface{})
	templateSpec, _ := template["spec"].(map[string]interface{})
	templateMeta, _ := template["metadata"].(map[string]interface{})
	templateLabels := strMap(templateMeta["labels"])

	var containerLines []string
	for _, c := range sliceOf(templateSpec["containers"]) {
		cm, _ := c.(map[string]interface{})
		if cm == nil {
			continue
		}
		name := strVal(cm["name"])
		image := strVal(cm["image"])
		var portStrs []string
		for _, p := range sliceOf(cm["ports"]) {
			pm, _ := p.(map[string]interface{})
			if pm == nil {
				continue
			}
			proto := strVal(pm["protocol"])
			if proto == "" {
				proto = "TCP"
			}
			portStrs = append(portStrs, fmt.Sprintf("%d/%s", intVal(pm["containerPort"]), proto))
		}
		ports := strings.Join(portStrs, ", ")
		if ports == "" {
			ports = "<none>"
		}
		var envLines []string
		for _, e := range sliceOf(cm["env"]) {
			em, _ := e.(map[string]interface{})
			if em == nil {
				continue
			}
			envLines = append(envLines, fmt.Sprintf("      %s:  %s", strVal(em["name"]), strVal(em["value"])))
		}
		envStr := strings.Join(envLines, "\n")
		if envStr == "" {
			envStr = "      <none>"
		}
		containerLines = append(containerLines, fmt.Sprintf("  %s:\n    Image:      %s\n    Port:       %s\n    Environment:\n%s", name, image, ports, envStr))
	}

	var condLines []string
	for _, c := range sliceOf(status["conditions"]) {
		cm, _ := c.(map[string]interface{})
		if cm == nil {
			continue
		}
		condLines = append(condLines, fmt.Sprintf("  %s%s%s%s",
			Pad(strVal(cm["type"]), 20),
			Pad(strVal(cm["status"]), 8),
			Pad(strVal(cm["reason"]), 25),
			strVal(cm["message"])))
	}

	selector, _ := spec["selector"].(map[string]interface{})
	matchLabels := strMap(selector["matchLabels"])
	selectorStr := formatKVInline(matchLabels)
	tlabelStr := formatKVInline(templateLabels)

	return fmt.Sprintf(`Name:                   %s
Namespace:              %s
CreationTimestamp:      %s
Labels:
%s
Annotations:
%s
Selector:               %s
Replicas:               %v desired | %v updated | %v total | %v ready | %v unavailable
StrategyType:           %s
Pod Template:
  Labels:  %s
  Containers:
%s
Conditions:
  Type                Status  Reason                   Message
  ----                ------  ------                   -------
%s
OldReplicaSets:       <none>
NewReplicaSet:        %s (%v/%v replicas created)
Events:               <none>`,
		strVal(m["name"]), strVal(m["namespace"]), strVal(m["creationTimestamp"]),
		labels, annotations, selectorStr,
		spec["replicas"], status["updatedReplicas"], status["replicas"], status["readyReplicas"], status["unavailableReplicas"],
		strategyType(spec),
		tlabelStr,
		strings.Join(containerLines, "\n"),
		strings.Join(condLines, "\n"),
		strVal(m["name"]), status["readyReplicas"], spec["replicas"],
	)
}

func GeneratePodDescribe(podName, namespace string) string {
	ns := namespace
	if ns == "" {
		ns = DefaultNamespace
	}
	snapshot := LoadText("pods-snapshot.txt", ns)
	if snapshot == "" {
		return fmt.Sprintf("Error from server (NotFound): pods %q not found", podName)
	}
	lines := strings.Split(strings.TrimSpace(snapshot), "\n")
	var podLine string
	for _, l := range lines {
		if strings.HasPrefix(strings.TrimSpace(l), podName) {
			podLine = l
			break
		}
	}
	if podLine == "" {
		return fmt.Sprintf("Error from server (NotFound): pods %q not found", podName)
	}
	parts := strings.Fields(podLine)
	get := func(i int) string {
		if i < len(parts) {
			return parts[i]
		}
		return "<unknown>"
	}
	ready := get(2) == "Running"
	return fmt.Sprintf(`Name:             %s
Namespace:        %s
Node:             %s
Status:           %s
IP:               %s
Containers:
  main:
    Ready:          %s
    Restart Count:  %s
Conditions:
  Type              Status
  Initialized       True
  Ready             %v
  ContainersReady   %v
  PodScheduled      True
Events:             <none>`,
		get(0), ns, get(6), get(2), get(5), get(1), get(3), ready, ready)
}

func GenerateServiceDescribe(item K8sItem) string {
	if item == nil {
		return "Error from server (NotFound): services not found"
	}
	m := ItemMeta(item)
	spec := ItemSpec(item)
	var portLines []string
	for _, p := range sliceOf(spec["ports"]) {
		pm, _ := p.(map[string]interface{})
		if pm == nil {
			continue
		}
		name := strVal(pm["name"])
		if name == "" {
			name = "<unset>"
		}
		proto := strVal(pm["protocol"])
		if proto == "" {
			proto = "TCP"
		}
		portLines = append(portLines, fmt.Sprintf("  Port:              %s  %d/%s\n  TargetPort:        %v/%s",
			name, intVal(pm["port"]), proto, pm["targetPort"], proto))
	}
	sel := strMap(spec["selector"])
	labels := ItemLabels(item)
	return fmt.Sprintf(`Name:              %s
Namespace:         %s
Labels:            %s
Selector:          %s
Type:              %s
IP:                %s
%s
Session Affinity:  %s
Events:            <none>`,
		strVal(m["name"]), strVal(m["namespace"]),
		formatKVInline(labels),
		formatKVInline(sel),
		strVal(spec["type"]),
		strVal(spec["clusterIP"]),
		strings.Join(portLines, "\n"),
		strVal(spec["sessionAffinity"]),
	)
}

func GenerateGenericDescribe(item K8sItem) string {
	if item == nil {
		return "Error from server (NotFound): resource not found"
	}
	m := ItemMeta(item)
	labels := formatKVInline(ItemLabels(item))
	if labels == "" {
		labels = "<none>"
	}
	annotations := formatKVStrInline(ItemAnnotations(item))
	if annotations == "" {
		annotations = "<none>"
	}
	var dataSection string
	if d, ok := item["data"].(map[string]interface{}); ok && len(d) > 0 {
		keys := make([]string, 0, len(d))
		for k := range d {
			keys = append(keys, k)
		}
		dataSection = "\nData:\n  " + strings.Join(keys, "\n  ")
	}
	typeSection := ""
	if t := strVal(item["type"]); t != "" {
		typeSection = "\nType:              " + t
	}
	return fmt.Sprintf(`Name:              %s
Namespace:         %s
Kind:              %s
Labels:            %s
Annotations:       %s
CreationTimestamp: %s%s%s
Events:            <none>`,
		strVal(m["name"]), strVal(m["namespace"]),
		strVal(item["kind"]),
		labels, annotations,
		strVal(m["creationTimestamp"]),
		typeSection, dataSection,
	)
}

// --- format helpers ---

func formatKV(m map[string]string, sep string) string {
	if len(m) == 0 {
		return sep + "<none>"
	}
	parts := make([]string, 0, len(m))
	for k, v := range m {
		parts = append(parts, sep+k+"="+v)
	}
	return strings.Join(parts, "\n")
}

func formatKVStr(m map[string]string, sep string) string {
	if len(m) == 0 {
		return sep + "<none>"
	}
	parts := make([]string, 0, len(m))
	for k, v := range m {
		parts = append(parts, sep+k+": "+v)
	}
	return strings.Join(parts, "\n")
}

func formatKVInline(m map[string]string) string {
	parts := make([]string, 0, len(m))
	for k, v := range m {
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, ",")
}

func formatKVStrInline(m map[string]string) string {
	parts := make([]string, 0, len(m))
	for k, v := range m {
		parts = append(parts, k+": "+v)
	}
	return strings.Join(parts, ", ")
}

func strategyType(spec map[string]interface{}) string {
	if s, ok := spec["strategy"].(map[string]interface{}); ok {
		if t := strVal(s["type"]); t != "" {
			return t
		}
	}
	return "RollingUpdate"
}
