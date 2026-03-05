package graph

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"kubecmds-viz/server/store"
)

// K8sItem is an alias for the store type.
type K8sItem = store.K8sItem

// GetItemsFn abstracts fetching K8s items — swappable between realtime and snapshot.
type GetItemsFn func(ns, resourceKey string) []K8sItem

// GetItemsFromSnapshot returns a GetItemsFn that reads from a snapshot namespace directory.
func GetItemsFromSnapshot(ns string) GetItemsFn {
	return func(_, resourceKey string) []K8sItem {
		list := store.LoadYaml(resourceKey+".yaml", ns)
		if list == nil {
			return nil
		}
		return list.Items
	}
}

// DiscoverNamespaces scans dataPath for namespace subdirectories.
func DiscoverNamespaces(dataPath string) []string {
	entries, err := os.ReadDir(dataPath)
	if err != nil {
		return nil
	}
	var namespaces []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if strings.HasPrefix(e.Name(), ".") || e.Name() == "_cluster" {
			continue
		}
		namespaces = append(namespaces, e.Name())
	}
	return namespaces
}

// SnapshotGetItemsFn returns a GetItemsFn that reads from k8s-snapshot/<ns>/.
func SnapshotGetItemsFn(ns string) GetItemsFn {
	nsDir := filepath.Join(store.BackupPath, ns)
	return func(_, resourceKey string) []K8sItem {
		list := store.LoadYaml(resourceKey+".yaml", ns)
		if list == nil {
			// Try alias resolution via store.
			_ = nsDir
			return nil
		}
		return list.Items
	}
}

// --- Image helpers ---

func shortenImage(img string) string {
	i := strings.LastIndex(img, "/")
	if i >= 0 {
		return img[i+1:]
	}
	return img
}

func commonRegistry(images []string) string {
	if len(images) < 2 {
		return ""
	}
	prefix := func(img string) string {
		i := strings.LastIndex(img, "/")
		if i >= 0 {
			return img[:i+1]
		}
		return ""
	}
	first := prefix(images[0])
	if first == "" {
		return ""
	}
	for _, img := range images[1:] {
		if prefix(img) != first {
			return ""
		}
	}
	return first
}

type imageInfo struct {
	full     []string
	short    []string
	registry string
}

func getContainerImages(podSpec map[string]interface{}) imageInfo {
	if podSpec == nil {
		return imageInfo{}
	}
	containers, _ := podSpec["containers"].([]interface{})
	initContainers, _ := podSpec["initContainers"].([]interface{})
	all := append(containers, initContainers...)
	var full []string
	for _, c := range all {
		cm, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		if img, ok := cm["image"].(string); ok && img != "" {
			full = append(full, img)
		}
	}
	short := make([]string, len(full))
	for i, img := range full {
		short[i] = shortenImage(img)
	}
	return imageInfo{full: full, short: short, registry: commonRegistry(full)}
}

// --- helpers for safe map access ---

func asMap(v interface{}) map[string]interface{} {
	m, _ := v.(map[string]interface{})
	return m
}

func asSlice(v interface{}) []interface{} {
	s, _ := v.([]interface{})
	return s
}

func asStr(v interface{}) string {
	s, _ := v.(string)
	return s
}

// --- ExtractWorkloadEdges ---

// ExtractWorkloadEdges discovers edges from a workload's podSpec to ConfigMaps, Secrets, PVCs, ServiceAccounts.
func ExtractWorkloadEdges(
	ns, kind, name string,
	podSpec map[string]interface{},
	addNode func(ns, kind, name, category string, meta map[string]interface{}) string,
	addEdge func(source, target, edgeType, sourceField string),
) {
	if podSpec == nil {
		return
	}
	sourceID := ns + "/" + kind + "/" + name

	if sa := asStr(podSpec["serviceAccountName"]); sa != "" && sa != "default" {
		addNode(ns, "ServiceAccount", sa, "rbac", nil)
		addEdge(sourceID, ns+"/ServiceAccount/"+sa, EdgeUsesServiceAccount, SFServiceAccountName)
	}

	containers := asSlice(podSpec["containers"])
	initContainers := asSlice(podSpec["initContainers"])
	allContainers := append(containers, initContainers...)

	for _, c := range allContainers {
		cm := asMap(c)
		for _, ef := range asSlice(cm["envFrom"]) {
			efm := asMap(ef)
			if cmRef := asMap(efm["configMapRef"]); cmRef != nil {
				if n := asStr(cmRef["name"]); n != "" {
					addNode(ns, "ConfigMap", n, "abstract", nil)
					addEdge(sourceID, ns+"/ConfigMap/"+n, EdgeUsesConfigMap, SFEnvFromConfigMap)
				}
			}
			if secRef := asMap(efm["secretRef"]); secRef != nil {
				if n := asStr(secRef["name"]); n != "" {
					addNode(ns, "Secret", n, "abstract", nil)
					addEdge(sourceID, ns+"/Secret/"+n, EdgeUsesSecret, SFEnvFromSecret)
				}
			}
		}
		for _, env := range asSlice(cm["env"]) {
			envm := asMap(env)
			vf := asMap(envm["valueFrom"])
			if vf == nil {
				continue
			}
			if cmKeyRef := asMap(vf["configMapKeyRef"]); cmKeyRef != nil {
				if n := asStr(cmKeyRef["name"]); n != "" {
					addNode(ns, "ConfigMap", n, "abstract", nil)
					addEdge(sourceID, ns+"/ConfigMap/"+n, EdgeUsesConfigMap, SFEnvConfigMapKey)
				}
			}
			if secKeyRef := asMap(vf["secretKeyRef"]); secKeyRef != nil {
				if n := asStr(secKeyRef["name"]); n != "" {
					addNode(ns, "Secret", n, "abstract", nil)
					addEdge(sourceID, ns+"/Secret/"+n, EdgeUsesSecret, SFEnvSecretKey)
				}
			}
		}
	}

	for _, vol := range asSlice(podSpec["volumes"]) {
		vm := asMap(vol)
		if pvc := asMap(vm["persistentVolumeClaim"]); pvc != nil {
			if n := asStr(pvc["claimName"]); n != "" {
				addNode(ns, "PersistentVolumeClaim", n, "storage", nil)
				addEdge(sourceID, ns+"/PersistentVolumeClaim/"+n, EdgeUsesPVC, SFVolumePVC)
			}
		}
		if cm := asMap(vm["configMap"]); cm != nil {
			if n := asStr(cm["name"]); n != "" {
				addNode(ns, "ConfigMap", n, "abstract", nil)
				addEdge(sourceID, ns+"/ConfigMap/"+n, EdgeUsesConfigMap, SFVolumeConfigMap)
			}
		}
		if sec := asMap(vm["secret"]); sec != nil {
			if n := asStr(sec["secretName"]); n != "" {
				addNode(ns, "Secret", n, "abstract", nil)
				addEdge(sourceID, ns+"/Secret/"+n, EdgeUsesSecret, SFVolumeSecret)
			}
		}
		if projected := asMap(vm["projected"]); projected != nil {
			for _, src := range asSlice(projected["sources"]) {
				sm := asMap(src)
				if projCm := asMap(sm["configMap"]); projCm != nil {
					if n := asStr(projCm["name"]); n != "" {
						addNode(ns, "ConfigMap", n, "abstract", nil)
						addEdge(sourceID, ns+"/ConfigMap/"+n, EdgeUsesConfigMap, SFProjectedConfigMap)
					}
				}
				if projSec := asMap(sm["secret"]); projSec != nil {
					if n := asStr(projSec["name"]); n != "" {
						addNode(ns, "Secret", n, "abstract", nil)
						addEdge(sourceID, ns+"/Secret/"+n, EdgeUsesSecret, SFProjectedSecret)
					}
				}
			}
		}
	}
}

// --- BuildGraph ---

// BuildGraph constructs the complete K8s resource topology graph.
func BuildGraph(getItems GetItemsFn, namespaceList []string) GraphResult {
	var nodes []GraphNode
	var edges []GraphEdge
	nodeIDs := map[string]bool{}
	edgeKeys := map[string]bool{}
	pods := map[string][]PodNode{}

	addNode := func(ns, kind, name, category string, meta map[string]interface{}) string {
		id := ns + "/" + kind + "/" + name
		if nodeIDs[id] {
			return id
		}
		nodeIDs[id] = true
		if meta == nil {
			meta = map[string]interface{}{}
		}
		nodes = append(nodes, GraphNode{ID: id, Name: name, Kind: kind, Category: category, Namespace: ns, Metadata: meta})
		return id
	}

	addEdge := func(source, target, edgeType, sourceField string) {
		key := source + "|" + target + "|" + edgeType
		if edgeKeys[key] {
			return
		}
		edgeKeys[key] = true
		edges = append(edges, GraphEdge{Source: source, Target: target, Type: edgeType, SourceField: sourceField})
	}

	for _, ns := range namespaceList {
		// Deployments
		type workloadRef struct{ kind, name string }
		var allWorkloads []workloadRef

		for _, d := range getItems(ns, "deployments") {
			name := store.ItemName(d)
			if name == "" {
				continue
			}
			spec := store.ItemSpec(d)
			templateSpec := asMap(asMap(spec["template"])["spec"])
			imgs := getContainerImages(templateSpec)
			addNode(ns, "Deployment", name, "workload", map[string]interface{}{
				"replicas":   spec["replicas"],
				"image":      first(imgs.full),
				"containers": imgs.short,
				"registry":   imgs.registry,
			})
			ExtractWorkloadEdges(ns, "Deployment", name, templateSpec, addNode, addEdge)
			allWorkloads = append(allWorkloads, workloadRef{"Deployment", name})
		}

		// StatefulSets
		for _, s := range getItems(ns, "statefulsets") {
			name := store.ItemName(s)
			if name == "" {
				continue
			}
			spec := store.ItemSpec(s)
			templateSpec := asMap(asMap(spec["template"])["spec"])
			imgs := getContainerImages(templateSpec)
			addNode(ns, "StatefulSet", name, "workload", map[string]interface{}{
				"replicas":   spec["replicas"],
				"image":      first(imgs.full),
				"containers": imgs.short,
				"registry":   imgs.registry,
			})
			ExtractWorkloadEdges(ns, "StatefulSet", name, templateSpec, addNode, addEdge)
			allWorkloads = append(allWorkloads, workloadRef{"StatefulSet", name})
		}

		// DaemonSets
		for _, ds := range getItems(ns, "daemonsets") {
			name := store.ItemName(ds)
			if name == "" {
				continue
			}
			spec := store.ItemSpec(ds)
			templateSpec := asMap(asMap(spec["template"])["spec"])
			imgs := getContainerImages(templateSpec)
			addNode(ns, "DaemonSet", name, "workload", map[string]interface{}{
				"image":      first(imgs.full),
				"containers": imgs.short,
				"registry":   imgs.registry,
			})
			ExtractWorkloadEdges(ns, "DaemonSet", name, templateSpec, addNode, addEdge)
			allWorkloads = append(allWorkloads, workloadRef{"DaemonSet", name})
		}

		// CronJobs
		for _, c := range getItems(ns, "cronjobs") {
			name := store.ItemName(c)
			if name == "" {
				continue
			}
			spec := store.ItemSpec(c)
			jobTemplate := asMap(spec["jobTemplate"])
			jobSpec := asMap(jobTemplate["spec"])
			templateSpec := asMap(asMap(jobSpec["template"])["spec"])
			addNode(ns, "CronJob", name, "workload", map[string]interface{}{
				"schedule": spec["schedule"],
			})
			ExtractWorkloadEdges(ns, "CronJob", name, templateSpec, addNode, addEdge)
		}

		// Services
		for _, svc := range getItems(ns, "services") {
			svcName := store.ItemName(svc)
			if svcName == "" {
				continue
			}
			spec := store.ItemSpec(svc)
			selector := asMap(spec["selector"])
			if selector == nil {
				continue
			}
			ports := asSlice(spec["ports"])
			portStrs := make([]string, 0, len(ports))
			for _, p := range ports {
				pm := asMap(p)
				proto := asStr(pm["protocol"])
				if proto == "" {
					proto = "TCP"
				}
				switch port := pm["port"].(type) {
				case int:
					portStrs = append(portStrs, strings.Join([]string{intToStr(port), proto}, "/"))
				case float64:
					portStrs = append(portStrs, strings.Join([]string{intToStr(int(port)), proto}, "/"))
				}
			}
			addNode(ns, "Service", svcName, "abstract", map[string]interface{}{
				"type":  spec["type"],
				"ports": portStrs,
			})
			for _, w := range allWorkloads {
				item := findWorkload(getItems, ns, w.kind, w.name)
				if item == nil {
					continue
				}
				wSpec := store.ItemSpec(*item)
				templateMeta := asMap(asMap(wSpec["template"])["metadata"])
				podLabelsStr := store.ItemLabels(templateMeta)
				podLabels := make(map[string]interface{}, len(podLabelsStr))
				for k, v := range podLabelsStr {
					podLabels[k] = v
				}
				if labelsMatch(selector, podLabels) {
					addEdge(ns+"/Service/"+svcName, ns+"/"+w.kind+"/"+w.name, EdgeExposes, SFSelector)
				}
			}
		}

		// HTTPRoutes
		for _, hr := range getItems(ns, "httproutes") {
			hrName := store.ItemName(hr)
			if hrName == "" {
				continue
			}
			spec := store.ItemSpec(hr)
			addNode(ns, "HTTPRoute", hrName, "abstract", map[string]interface{}{
				"hostnames": spec["hostnames"],
			})
			for _, pr := range asSlice(spec["parentRefs"]) {
				prm := asMap(pr)
				if n := asStr(prm["name"]); n != "" {
					gwNs := asStr(prm["namespace"])
					if gwNs == "" {
						gwNs = ns
					}
					addNode(gwNs, "Gateway", n, "abstract", nil)
					addEdge(ns+"/HTTPRoute/"+hrName, gwNs+"/Gateway/"+n, EdgeParentGateway, SFParentRefs)
				}
			}
			for _, rule := range asSlice(spec["rules"]) {
				for _, br := range asSlice(asMap(rule)["backendRefs"]) {
					brm := asMap(br)
					if n := asStr(brm["name"]); n != "" {
						backendNs := asStr(brm["namespace"])
						if backendNs == "" {
							backendNs = ns
						}
						svcID := backendNs + "/Service/" + n
						if nodeIDs[svcID] {
							addEdge(ns+"/HTTPRoute/"+hrName, svcID, EdgeRoutesTo, SFBackendRefs)
						}
					}
				}
			}
		}

		// TCPRoutes
		for _, tr := range getItems(ns, "tcproutes") {
			trName := store.ItemName(tr)
			if trName == "" {
				continue
			}
			spec := store.ItemSpec(tr)
			addNode(ns, "TCPRoute", trName, "abstract", nil)
			for _, pr := range asSlice(spec["parentRefs"]) {
				prm := asMap(pr)
				if n := asStr(prm["name"]); n != "" {
					gwNs := asStr(prm["namespace"])
					if gwNs == "" {
						gwNs = ns
					}
					addNode(gwNs, "Gateway", n, "abstract", nil)
					addEdge(ns+"/TCPRoute/"+trName, gwNs+"/Gateway/"+n, EdgeParentGateway, SFParentRefs)
				}
			}
			for _, rule := range asSlice(spec["rules"]) {
				for _, br := range asSlice(asMap(rule)["backendRefs"]) {
					brm := asMap(br)
					if n := asStr(brm["name"]); n != "" {
						backendNs := asStr(brm["namespace"])
						if backendNs == "" {
							backendNs = ns
						}
						svcID := backendNs + "/Service/" + n
						if nodeIDs[svcID] {
							addEdge(ns+"/TCPRoute/"+trName, svcID, EdgeRoutesTo, SFBackendRefs)
						}
					}
				}
			}
		}

		// Gateways
		for _, gw := range getItems(ns, "gateways") {
			gwName := store.ItemName(gw)
			if gwName == "" {
				continue
			}
			spec := store.ItemSpec(gw)
			addNode(ns, "Gateway", gwName, "abstract", map[string]interface{}{
				"gatewayClassName": spec["gatewayClassName"],
			})
		}

		// Ingresses
		for _, ing := range getItems(ns, "ingresses") {
			ingName := store.ItemName(ing)
			if ingName == "" {
				continue
			}
			spec := store.ItemSpec(ing)
			rules := asSlice(spec["rules"])
			var hosts []string
			for _, r := range rules {
				if h := asStr(asMap(r)["host"]); h != "" {
					hosts = append(hosts, h)
				}
			}
			addNode(ns, "Ingress", ingName, "abstract", map[string]interface{}{
				"hosts": hosts,
			})
			for _, rule := range rules {
				rm := asMap(rule)
				httpObj := asMap(rm["http"])
				for _, p := range asSlice(httpObj["paths"]) {
					backend := asMap(asMap(p)["backend"])
					backendName := asStr(asMap(backend["service"])["name"])
					if backendName == "" {
						backendName = asStr(backend["serviceName"])
					}
					if backendName != "" && nodeIDs[ns+"/Service/"+backendName] {
						addEdge(ns+"/Ingress/"+ingName, ns+"/Service/"+backendName, EdgeRoutesTo, SFIngressBackend)
					}
				}
			}
		}

		// HPAs
		for _, hpa := range getItems(ns, "horizontalpodautoscalers") {
			hpaName := store.ItemName(hpa)
			if hpaName == "" {
				continue
			}
			spec := store.ItemSpec(hpa)
			addNode(ns, "HorizontalPodAutoscaler", hpaName, "abstract", map[string]interface{}{
				"minReplicas": spec["minReplicas"],
				"maxReplicas": spec["maxReplicas"],
			})
			scaleTargetRef := asMap(spec["scaleTargetRef"])
			targetName := asStr(scaleTargetRef["name"])
			targetKind := asStr(scaleTargetRef["kind"])
			if targetName != "" && targetKind != "" {
				targetID := ns + "/" + targetKind + "/" + targetName
				if nodeIDs[targetID] {
					addEdge(ns+"/HorizontalPodAutoscaler/"+hpaName, targetID, EdgeExposes, SFScaleTargetRef)
				}
			}
		}

		// RoleBindings
		for _, rb := range getItems(ns, "rolebindings") {
			rbName := store.ItemName(rb)
			if rbName == "" {
				continue
			}
			addNode(ns, "RoleBinding", rbName, "rbac", nil)
			roleRef := asMap(rb["roleRef"])
			if n := asStr(roleRef["name"]); n != "" {
				addNode(ns, "Role", n, "rbac", nil)
				addEdge(ns+"/RoleBinding/"+rbName, ns+"/Role/"+n, EdgeBindsRole, SFRoleRef)
			}
			for _, subj := range asSlice(rb["subjects"]) {
				sm := asMap(subj)
				if asStr(sm["kind"]) == "ServiceAccount" {
					if n := asStr(sm["name"]); n != "" {
						saID := ns + "/ServiceAccount/" + n
						if nodeIDs[saID] {
							addEdge(ns+"/RoleBinding/"+rbName, saID, EdgeBindsRole, SFSubjects)
						}
					}
				}
			}
		}

		// ConfigMaps (orphan pass)
		for _, cm := range getItems(ns, "configmaps") {
			cmName := store.ItemName(cm)
			if cmName == "" {
				continue
			}
			cmID := ns + "/ConfigMap/" + cmName
			if !nodeIDs[cmID] {
				addNode(ns, "ConfigMap", cmName, "abstract", map[string]interface{}{"orphan": true})
			}
		}
	}

	// Pods — grouped by parent workload
	for _, ns := range namespaceList {
		for _, pod := range getItems(ns, "pods") {
			podName := store.ItemName(pod)
			if podName == "" {
				continue
			}
			podStatus := store.ItemStatus(pod)
			phase := asStr(podStatus["phase"])
			if phase == "" {
				phase = PodUnknown
			}
			displayStatus := phase
			for _, cs := range asSlice(podStatus["containerStatuses"]) {
				csm := asMap(cs)
				waiting := asMap(asMap(csm["state"])["waiting"])
				if asStr(waiting["reason"]) == PodCrashLoopBackOff {
					displayStatus = PodCrashLoopBackOff
					break
				}
			}

			podSpec := asMap(pod["spec"])
			imgs := getContainerImages(podSpec)
			nodeName := asStr(podSpec["nodeName"])

			var restarts int
			for _, cs := range asSlice(podStatus["containerStatuses"]) {
				csm := asMap(cs)
				switch rc := csm["restartCount"].(type) {
				case int:
					restarts += rc
				case float64:
					restarts += int(rc)
				}
			}

			var ownerKind, ownerName string
			for _, ref := range asSlice(store.ItemMeta(pod)["ownerReferences"]) {
				rm := asMap(ref)
				switch asStr(rm["kind"]) {
				case "ReplicaSet":
					rsName := asStr(rm["name"])
					lastDash := strings.LastIndex(rsName, "-")
					if lastDash > 0 {
						ownerName = rsName[:lastDash]
					} else {
						ownerName = rsName
					}
					ownerKind = "Deployment"
				case "StatefulSet":
					ownerKind = "StatefulSet"
					ownerName = asStr(rm["name"])
				case "Job":
					jobName := asStr(rm["name"])
					lastDash := strings.LastIndex(jobName, "-")
					possibleCronJob := jobName
					if lastDash > 0 {
						possibleCronJob = jobName[:lastDash]
					}
					if nodeIDs[ns+"/CronJob/"+possibleCronJob] {
						ownerKind = "CronJob"
						ownerName = possibleCronJob
					} else {
						ownerKind = "Job"
						ownerName = jobName
					}
				}
			}

			if ownerKind == "" || ownerName == "" {
				continue
			}
			parentID := ns + "/" + ownerKind + "/" + ownerName
			if !nodeIDs[parentID] {
				continue
			}

			pods[parentID] = append(pods[parentID], PodNode{
				ID:        ns + "/Pod/" + podName,
				Name:      podName,
				Kind:      "Pod",
				Category:  "workload",
				Namespace: ns,
				Metadata: map[string]interface{}{
					"status":     displayStatus,
					"ownerKind":  ownerKind,
					"ownerName":  ownerName,
					"image":      first(imgs.full),
					"containers": imgs.short,
					"registry":   imgs.registry,
					"node":       nodeName,
					"restarts":   restarts,
				},
			})
		}
	}

	byKind := map[string]int{}
	for _, n := range nodes {
		byKind[n.Kind]++
	}

	allNs := make([]string, len(namespaceList))
	copy(allNs, namespaceList)
	sort.Strings(allNs)

	return GraphResult{
		Nodes:      nodes,
		Edges:      edges,
		Pods:       pods,
		Namespaces: allNs,
		Stats: GraphStats{
			TotalNodes:     len(nodes),
			TotalEdges:     len(edges),
			ByKind:         byKind,
			NamespaceCount: len(namespaceList),
		},
	}
}

// --- small helpers ---

func first(ss []string) string {
	if len(ss) > 0 {
		return ss[0]
	}
	return ""
}

func intToStr(n int) string {
	return strings.TrimRight(strings.TrimRight(
		strings.Replace(strings.Replace(
			strings.Replace(string(rune('0'+n%10)), string(rune('0'+n/10%10)), "", -1),
			"", "", -1), "", "", -1), "0"), ".")
}

func labelsMatch(selector, podLabels map[string]interface{}) bool {
	for k, v := range selector {
		sv, _ := v.(string)
		pv, _ := podLabels[k].(string)
		if sv != pv {
			return false
		}
	}
	return true
}

// findWorkload retrieves a workload item by kind/name from getItems.
func findWorkload(getItems GetItemsFn, ns, kind, name string) *K8sItem {
	resource := strings.ToLower(kind) + "s"
	for _, item := range getItems(ns, resource) {
		if store.ItemName(item) == name {
			return &item
		}
	}
	return nil
}
