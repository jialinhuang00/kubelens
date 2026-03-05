package main

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"text/tabwriter"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

// gvrTable maps resource name → GroupVersionResource.
// For namespaced standard resources and common CRDs.
var gvrTable = map[string]schema.GroupVersionResource{
	// core
	"pods":                    {Group: "", Version: "v1", Resource: "pods"},
	"services":                {Group: "", Version: "v1", Resource: "services"},
	"configmaps":              {Group: "", Version: "v1", Resource: "configmaps"},
	"secrets":                 {Group: "", Version: "v1", Resource: "secrets"},
	"serviceaccounts":         {Group: "", Version: "v1", Resource: "serviceaccounts"},
	"persistentvolumeclaims":  {Group: "", Version: "v1", Resource: "persistentvolumeclaims"},
	"endpoints":               {Group: "", Version: "v1", Resource: "endpoints"},
	"resourcequotas":          {Group: "", Version: "v1", Resource: "resourcequotas"},
	"limitranges":             {Group: "", Version: "v1", Resource: "limitranges"},
	// apps
	"deployments":  {Group: "apps", Version: "v1", Resource: "deployments"},
	"statefulsets": {Group: "apps", Version: "v1", Resource: "statefulsets"},
	"daemonsets":   {Group: "apps", Version: "v1", Resource: "daemonsets"},
	"replicasets":  {Group: "apps", Version: "v1", Resource: "replicasets"},
	// batch
	"jobs":     {Group: "batch", Version: "v1", Resource: "jobs"},
	"cronjobs": {Group: "batch", Version: "v1", Resource: "cronjobs"},
	// networking.k8s.io
	"ingresses":       {Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"},
	"networkpolicies": {Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"},
	// rbac
	"roles":         {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"},
	"rolebindings":  {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"},
	// autoscaling
	"horizontalpodautoscalers": {Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"},
	// policy
	"poddisruptionbudgets": {Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"},
	// Gateway API CRDs
	"gateways.gateway.networking.k8s.io":   {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "gateways"},
	"httproutes.gateway.networking.k8s.io": {Group: "gateway.networking.k8s.io", Version: "v1", Resource: "httproutes"},
	"tcproutes.gateway.networking.k8s.io":  {Group: "gateway.networking.k8s.io", Version: "v1alpha2", Resource: "tcproutes"},
	// Istio CRDs
	"virtualservices.networking.istio.io":  {Group: "networking.istio.io", Version: "v1beta1", Resource: "virtualservices"},
	"destinationrules.networking.istio.io": {Group: "networking.istio.io", Version: "v1beta1", Resource: "destinationrules"},
	"serviceentries.networking.istio.io":   {Group: "networking.istio.io", Version: "v1beta1", Resource: "serviceentries"},
	// ArgoCD
	"applications.argoproj.io": {Group: "argoproj.io", Version: "v1alpha1", Resource: "applications"},
}

// fetchBatch fetches all resource types in a comma-separated batch string.
// Returns merged list of all items across all resource types in the batch.
// Errors for individual resource types (e.g. CRD not installed) are silently ignored.
func fetchBatch(dynClient dynamic.Interface, ns, batch string) []unstructured.Unstructured {
	resourceTypes := strings.Split(batch, ",")

	type result struct {
		items []unstructured.Unstructured
	}
	ch := make(chan result, len(resourceTypes))

	for _, rt := range resourceTypes {
		rt := strings.TrimSpace(rt)
		go func() {
			items, err := fetchResourceType(dynClient, ns, rt)
			if err != nil {
				ch <- result{}
				return
			}
			ch <- result{items: items}
		}()
	}

	var all []unstructured.Unstructured
	for range resourceTypes {
		r := <-ch
		all = append(all, r.items...)
	}
	return all
}

// fetchResourceType fetches a single resource type (e.g. "deployments") in a namespace.
// Returns empty slice without error if the resource type does not exist on the cluster.
func fetchResourceType(dynClient dynamic.Interface, ns, resourceType string) ([]unstructured.Unstructured, error) {
	gvr, ok := gvrTable[resourceType]
	if !ok {
		return nil, nil // unknown resource type — skip silently
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	list, err := dynClient.Resource(gvr).Namespace(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		// Resource not found on this cluster (CRD not installed) — skip silently.
		if isNotFoundErr(err) {
			return nil, nil
		}
		return nil, err
	}
	return list.Items, nil
}

// fetchPodsTyped fetches pods using the typed client (needed for table formatting).
func fetchPodsTyped(k8sClient kubernetes.Interface, ns string) (*corev1.PodList, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return k8sClient.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
}

// formatPodsWide formats a pod list as `kubectl get pods -o wide` table text.
// Column order: NAME READY STATUS RESTARTS AGE IP NODE NOMINATED-NODE READINESS-GATES
func formatPodsWide(pods *corev1.PodList) string {
	var buf bytes.Buffer
	w := tabwriter.NewWriter(&buf, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "NAME\tREADY\tSTATUS\tRESTARTS\tAGE\tIP\tNODE\tNOMINATED NODE\tREADINESS GATES")
	for _, pod := range pods.Items {
		ready, total := readyCount(&pod)
		status := podStatus(&pod)
		restarts := podRestarts(&pod)
		age := formatAge(pod.CreationTimestamp.Time)
		ip := pod.Status.PodIP
		if ip == "" {
			ip = "<none>"
		}
		node := pod.Spec.NodeName
		if node == "" {
			node = "<none>"
		}
		fmt.Fprintf(w, "%s\t%d/%d\t%s\t%d\t%s\t%s\t%s\t<none>\t<none>\n",
			pod.Name, ready, total, status, restarts, age, ip, node)
	}
	w.Flush()
	return buf.String()
}

// formatPodsImages formats a pod list as `kubectl get pods -o custom-columns=POD:...,IMAGE:...` text.
// Format: POD<tab>IMAGE  where IMAGE is comma-separated list of all container images.
func formatPodsImages(pods *corev1.PodList) string {
	var buf bytes.Buffer
	w := tabwriter.NewWriter(&buf, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "POD\tIMAGE")
	for _, pod := range pods.Items {
		images := make([]string, 0, len(pod.Spec.Containers))
		for _, c := range pod.Spec.Containers {
			images = append(images, c.Image)
		}
		fmt.Fprintf(w, "%s\t%s\n", pod.Name, strings.Join(images, ","))
	}
	w.Flush()
	return buf.String()
}

// --- helpers ---

func readyCount(pod *corev1.Pod) (ready, total int) {
	total = len(pod.Spec.Containers)
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.Ready {
			ready++
		}
	}
	return
}

func podStatus(pod *corev1.Pod) string {
	if pod.DeletionTimestamp != nil {
		return "Terminating"
	}
	// Check init containers first.
	for _, cs := range pod.Status.InitContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			return cs.State.Waiting.Reason
		}
	}
	// Then regular containers.
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			return cs.State.Waiting.Reason
		}
		if cs.State.Terminated != nil && cs.State.Terminated.ExitCode != 0 {
			if cs.State.Terminated.Reason != "" {
				return cs.State.Terminated.Reason
			}
			return "Error"
		}
	}
	if string(pod.Status.Phase) != "" {
		return string(pod.Status.Phase)
	}
	return "Unknown"
}

func podRestarts(pod *corev1.Pod) int {
	total := 0
	for _, cs := range pod.Status.ContainerStatuses {
		total += int(cs.RestartCount)
	}
	return total
}

func formatAge(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

// podsToUnstructured converts a typed PodList to unstructured items for writeBatchResults.
// Uses runtime.DefaultUnstructuredConverter so all spec/status fields are preserved.
func podsToUnstructured(podList *corev1.PodList) []unstructured.Unstructured {
	items := make([]unstructured.Unstructured, 0, len(podList.Items))
	for i := range podList.Items {
		pod := &podList.Items[i]
		pod.TypeMeta.APIVersion = "v1"
		pod.TypeMeta.Kind = "Pod"
		obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(pod)
		if err != nil {
			continue
		}
		items = append(items, unstructured.Unstructured{Object: obj})
	}
	return items
}

// isNotFoundErr returns true for "resource not found" API errors (CRD not installed).
func isNotFoundErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "not found") ||
		strings.Contains(msg, "no matches for kind") ||
		strings.Contains(msg, "the server could not find the requested resource")
}
