// Package store reads and caches YAML/text files from k8s-snapshot/.
// Routes use this package for offline snapshot mode.
package store

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

// K8sItem is a single K8s resource (Deployment, Service, Pod, etc.).
type K8sItem = map[string]interface{}

// K8sList is a K8s list response (e.g. DeploymentList).
type K8sList struct {
	APIVersion string    `yaml:"apiVersion"`
	Kind       string    `yaml:"kind"`
	Items      []K8sItem `yaml:"items"`
}

// SnapshotDir is where the snapshot lives, for readers and writers alike:
// K8S_SNAPSHOT_PATH if set, otherwise `k8s-snapshot` under the working
// directory. Mirrors snapshotDir() in api/utils/paths.ts.
//
// A function, not a package-level var. Two reasons, and each has already cost
// something. Go evaluates package-level initialisers before main() chdirs to
// PROJECT_ROOT, so a relative K8S_SNAPSHOT_PATH would resolve against whatever
// directory the process started in — the same trap as fileAliases. And it used
// to be the only place in the Go backend that read this variable at all: the
// export route held a bare "k8s-snapshot" string and the ping handler had its
// own literal, so an export wrote one directory, the ping checked a second, and
// Snapshot mode read a third.
func SnapshotDir() string {
	if p := os.Getenv("K8S_SNAPSHOT_PATH"); p != "" {
		return p
	}
	if p := os.Getenv("K8S_SNAPSHOT_DIR"); p != "" {
		return p
	}
	return "k8s-snapshot"
}

const DefaultNamespace = "demo"

// fileAliases maps resource names to candidate YAML filenames.
// Derived from kubelens.config.yaml (CRDs whose files are group-qualified).
// Lazy: package-level init would run before main() chdirs to PROJECT_ROOT,
// making the config unreadable (and the empty result cached forever).
var (
	fileAliasesOnce sync.Once
	fileAliasesMap  map[string][]string
)

func fileAliases() map[string][]string {
	fileAliasesOnce.Do(func() { fileAliasesMap = FileAliases() })
	return fileAliasesMap
}

// cache stores parsed YAML lists and text file contents.
// Key: "ns:filename" for YAML, "text:ns:filename" for text.
var (
	cacheMu sync.RWMutex
	cache   = map[string]interface{}{}
)

// ResolveFilePath resolves a snapshot filename to an absolute path.
// Checks the namespace subdirectory first, then tries fileAliases.
func ResolveFilePath(filename, namespace string) string {
	if namespace == "" {
		return ""
	}
	nsDir := filepath.Join(SnapshotDir(), namespace)

	// Direct match.
	p := filepath.Join(nsDir, filename)
	if _, err := os.Stat(p); err == nil {
		return p
	}

	// Alias match.
	baseName := strings.TrimSuffix(filename, ".yaml")
	if aliases, ok := fileAliases()[baseName]; ok {
		for _, alias := range aliases {
			p = filepath.Join(nsDir, alias)
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}
	return ""
}

// LoadYaml loads and parses a YAML list file from the snapshot directory.
// Results are cached in memory.
func LoadYaml(filename, namespace string) *K8sList {
	key := namespace + ":" + filename

	cacheMu.RLock()
	if v, ok := cache[key]; ok {
		cacheMu.RUnlock()
		if list, ok := v.(*K8sList); ok {
			return list
		}
		return nil
	}
	cacheMu.RUnlock()

	path := ResolveFilePath(filename, namespace)
	if path == "" {
		return nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	var list K8sList
	if err := yaml.Unmarshal(data, &list); err != nil {
		return nil
	}

	cacheMu.Lock()
	cache[key] = &list
	cacheMu.Unlock()
	return &list
}

// LoadText loads a text file from the snapshot directory.
// Results are cached in memory.
func LoadText(filename, namespace string) string {
	key := "text:" + namespace + ":" + filename

	cacheMu.RLock()
	if v, ok := cache[key]; ok {
		cacheMu.RUnlock()
		if s, ok := v.(string); ok {
			return s
		}
		return ""
	}
	cacheMu.RUnlock()

	path := ResolveFilePath(filename, namespace)
	if path == "" {
		return ""
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	s := string(data)
	cacheMu.Lock()
	cache[key] = s
	cacheMu.Unlock()
	return s
}

// ListBackupNamespaces lists all namespace directories under the snapshot root.
func ListBackupNamespaces() []string {
	entries, err := os.ReadDir(SnapshotDir())
	if err != nil {
		return []string{DefaultNamespace}
	}
	var namespaces []string
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") && e.Name() != "_cluster" {
			namespaces = append(namespaces, e.Name())
		}
	}
	if len(namespaces) == 0 {
		return []string{DefaultNamespace}
	}
	return namespaces
}

// --- Item helpers ---

func ItemMeta(item K8sItem) map[string]interface{} {
	if m, ok := item["metadata"].(map[string]interface{}); ok {
		return m
	}
	return map[string]interface{}{}
}

func ItemName(item K8sItem) string {
	return strVal(ItemMeta(item)["name"])
}

func ItemNamespace(item K8sItem) string {
	return strVal(ItemMeta(item)["namespace"])
}

func ItemCreationTimestamp(item K8sItem) string {
	return strVal(ItemMeta(item)["creationTimestamp"])
}

func ItemLabels(item K8sItem) map[string]string {
	return strMap(ItemMeta(item)["labels"])
}

func ItemAnnotations(item K8sItem) map[string]string {
	return strMap(ItemMeta(item)["annotations"])
}

func ItemSpec(item K8sItem) map[string]interface{} {
	if s, ok := item["spec"].(map[string]interface{}); ok {
		return s
	}
	return map[string]interface{}{}
}

func ItemStatus(item K8sItem) map[string]interface{} {
	if s, ok := item["status"].(map[string]interface{}); ok {
		return s
	}
	return map[string]interface{}{}
}

// --- Type helpers ---

func strVal(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func intVal(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

func strMap(v interface{}) map[string]string {
	m, ok := v.(map[string]interface{})
	if !ok {
		return map[string]string{}
	}
	result := make(map[string]string, len(m))
	for k, val := range m {
		result[k] = strVal(val)
	}
	return result
}

func sliceOf(v interface{}) []interface{} {
	if s, ok := v.([]interface{}); ok {
		return s
	}
	return nil
}
