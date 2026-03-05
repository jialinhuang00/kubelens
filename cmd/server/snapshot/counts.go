package snapshot

import (
	"bufio"
	"strings"
)

// GetResourceCounts returns a map of resource type → count for a given namespace.
// Pods are counted from pods-snapshot.txt (line count); all other resources from their YAML files.
func GetResourceCounts(namespace string) map[string]int {
	counts := map[string]int{
		"pods":                   0,
		"deployments":            0,
		"services":               0,
		"cronjobs":               0,
		"jobs":                   0,
		"statefulsets":           0,
		"configmaps":             0,
		"secrets":                0,
		"serviceaccounts":        0,
		"persistentvolumeclaims": 0,
		"endpoints":              0,
		"replicasets":            0,
		"poddisruptionbudgets":   0,
		"roles":                  0,
		"rolebindings":           0,
	}

	// Pods — count data rows in pods-snapshot.txt (skip header line).
	podsText := LoadText("pods-snapshot.txt", namespace)
	if podsText != "" {
		scanner := bufio.NewScanner(strings.NewReader(podsText))
		lineNum := 0
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			lineNum++
			if lineNum > 1 { // skip header
				counts["pods"]++
			}
		}
	}

	// YAML-backed resources — use items array length.
	yamlResources := map[string]string{
		"deployments":            "deployments.yaml",
		"services":               "services.yaml",
		"cronjobs":               "cronjobs.yaml",
		"jobs":                   "jobs.yaml",
		"statefulsets":           "statefulsets.yaml",
		"configmaps":             "configmaps.yaml",
		"secrets":                "secrets.yaml",
		"serviceaccounts":        "serviceaccounts.yaml",
		"persistentvolumeclaims": "persistentvolumeclaims.yaml",
		"endpoints":              "endpoints.yaml",
		"replicasets":            "replicasets.yaml",
		"poddisruptionbudgets":   "poddisruptionbudgets.yaml",
		"roles":                  "roles.yaml",
		"rolebindings":           "rolebindings.yaml",
	}
	for resource, filename := range yamlResources {
		if list := LoadYaml(filename, namespace); list != nil {
			counts[resource] = len(list.Items)
		}
	}

	return counts
}
