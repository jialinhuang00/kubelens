package main

import "strings"

// kindMap mirrors scripts/kind-map.json — Kind → output filename (without .yaml).
// Keep in sync with scripts/kind-map.json when adding new resource types.
var kindMap = map[string]string{
	"Deployment":              "deployments",
	"Service":                 "services",
	"ConfigMap":               "configmaps",
	"Secret":                  "secrets",
	"Ingress":                 "ingresses",
	"StatefulSet":             "statefulsets",
	"DaemonSet":               "daemonsets",
	"CronJob":                 "cronjobs",
	"Job":                     "jobs",
	"ServiceAccount":          "serviceaccounts",
	"Role":                    "roles",
	"RoleBinding":             "rolebindings",
	"PersistentVolumeClaim":   "persistentvolumeclaims",
	"NetworkPolicy":           "networkpolicies",
	"HorizontalPodAutoscaler": "horizontalpodautoscalers",
	"PodDisruptionBudget":     "poddisruptionbudgets",
	"Pod":                     "pods",
	"Endpoints":               "endpoints",
	"ResourceQuota":           "resourcequotas",
	"LimitRange":              "limitranges",
	// CRDs
	"Gateway":         "gateways.gateway.networking.k8s.io",
	"HTTPRoute":       "httproutes.gateway.networking.k8s.io",
	"TCPRoute":        "tcproutes.gateway.networking.k8s.io",
	"VirtualService":  "virtualservices.networking.istio.io",
	"DestinationRule": "destinationrules.networking.istio.io",
	"ServiceEntry":    "serviceentries.networking.istio.io",
	"Application":     "applications.argoproj.io",
}

// kindToFilename returns the output filename (without .yaml) for a given K8s Kind.
// Falls back to lowercase(kind)+"s" if the kind is not in the map.
func kindToFilename(kind string) string {
	if name, ok := kindMap[kind]; ok {
		return name
	}
	return strings.ToLower(kind) + "s"
}
