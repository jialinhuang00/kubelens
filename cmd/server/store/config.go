package store

import (
	"log"
	"os"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

// ResourceConfig is one entry from kubelens.config.yaml. JSON tags must stay
// camelCase so the frontend ConfigService can read /api/config from the Go
// backend the same way it reads it from the Node backend.
type ResourceConfig struct {
	Kind         string   `yaml:"kind" json:"kind"`
	Key          string   `yaml:"key" json:"key"`
	ResourceType string   `yaml:"resourceType" json:"resourceType"`
	NamePrefix   string   `yaml:"namePrefix" json:"namePrefix"`
	Group        string   `yaml:"group" json:"group"`
	Label        string   `yaml:"label" json:"label"`
	Color        string   `yaml:"color" json:"color"`
	Priority     bool     `yaml:"priority" json:"priority"`
	Show         []string `yaml:"show" json:"show"`
	Default      []string `yaml:"default" json:"default,omitempty"`
	Aliases      []string `yaml:"aliases" json:"aliases,omitempty"`
}

// TemplateEntry is one panel command button from kubelens.config.yaml.
type TemplateEntry struct {
	Name          string `yaml:"name" json:"name"`
	Command       string `yaml:"command" json:"command"`
	RequiresInput bool   `yaml:"requiresInput" json:"requiresInput,omitempty"`
	Disabled      bool   `yaml:"disabled" json:"disabled,omitempty"`
}

// TableColumn is one column of a snapshot `kubectl get` table. `Value` is a
// template: `{.path}` reads a field, `{.path|transform}` runs it through one,
// `{|transform}` reads the whole item, and `{...?fallback}` supplies a default.
type TableColumn struct {
	Name  string `yaml:"name" json:"name"`
	Value string `yaml:"value" json:"value"`
	Width int    `yaml:"width" json:"width,omitempty"`
}

// TableSpec is one kind's table, keyed by Kind in the config's `tables:` section.
type TableSpec struct {
	Columns []TableColumn `yaml:"columns" json:"columns"`
}

var (
	resourceCache []ResourceConfig
	resourceOnce  sync.Once

	templateCache map[string][]TemplateEntry
	templateOnce  sync.Once

	tableCache map[string]TableSpec
	tableOnce  sync.Once

	discoveryGroups    []string
	discoveryResources []string
	discoveryOnce      sync.Once
)

// LoadTemplates reads and caches the per-kind panel command templates.
func LoadTemplates() map[string][]TemplateEntry {
	templateOnce.Do(func() {
		data, err := os.ReadFile("kubelens.config.yaml")
		if err != nil {
			log.Printf("failed to read kubelens.config.yaml: %v", err)
			return
		}
		var parsed struct {
			Templates map[string][]TemplateEntry `yaml:"templates"`
		}
		if err := yaml.Unmarshal(data, &parsed); err != nil {
			log.Printf("failed to parse kubelens.config.yaml: %v", err)
			return
		}
		templateCache = parsed.Templates
	})
	return templateCache
}

// LoadTables reads and caches the per-kind snapshot table specs.
//
// This section had no Go struct at all until 2026-08-07, and the Go backend
// rendered seven hand-written tables instead. Nine kinds the config declares
// (Secret, PVC, ServiceAccount, DaemonSet, Ingress, HPA, Role, RoleBinding,
// NetworkPolicy) came back from `dev:go` as a bare list of names, and editing
// the config changed nothing on this backend.
func LoadTables() map[string]TableSpec {
	tableOnce.Do(func() {
		data, err := os.ReadFile("kubelens.config.yaml")
		if err != nil {
			log.Printf("failed to read kubelens.config.yaml: %v", err)
			return
		}
		var parsed struct {
			Tables map[string]TableSpec `yaml:"tables"`
		}
		if err := yaml.Unmarshal(data, &parsed); err != nil {
			log.Printf("failed to parse kubelens.config.yaml: %v", err)
			return
		}
		tableCache = parsed.Tables
	})
	return tableCache
}

// Snapshot-exported files with no `resources:` entry (no tree or graph role),
// mapped to the Kind their table spec is keyed under. Mirrors FILE_KIND_EXTRA
// in api/utils/config-loader.ts.
var fileKindExtra = map[string]string{"endpoints.yaml": "Endpoints"}

// GetTableSpecForFile resolves a snapshot filename ("deployments.yaml") to its
// table spec through its Kind. Returns ok=false when the config declares none.
func GetTableSpecForFile(yamlFile string) (TableSpec, bool) {
	key := strings.TrimSuffix(yamlFile, ".yaml")
	kind := fileKindExtra[yamlFile]
	for _, r := range LoadResources() {
		if r.Key == key {
			kind = r.Kind
			break
		}
	}
	if kind == "" {
		return TableSpec{}, false
	}
	spec, ok := LoadTables()[kind]
	return spec, ok
}

// LoadResources reads and caches kubelens.config.yaml. CWD is PROJECT_ROOT
// (set in main), so a relative path resolves to the repo root.
func LoadResources() []ResourceConfig {
	resourceOnce.Do(func() {
		data, err := os.ReadFile("kubelens.config.yaml")
		if err != nil {
			log.Printf("failed to read kubelens.config.yaml: %v", err)
			return
		}
		var parsed struct {
			Resources []ResourceConfig `yaml:"resources"`
		}
		if err := yaml.Unmarshal(data, &parsed); err != nil {
			log.Printf("failed to parse kubelens.config.yaml: %v", err)
			return
		}
		resourceCache = parsed.Resources
	})
	return resourceCache
}

// LoadDiscoveryExclude returns the groups and resource names `kubectl
// api-resources` output should drop before it reaches the visibility panel:
// leases, events, EKS networking internals and the like.
func LoadDiscoveryExclude() (groups []string, resources []string) {
	discoveryOnce.Do(func() {
		data, err := os.ReadFile("kubelens.config.yaml")
		if err != nil {
			log.Printf("failed to read kubelens.config.yaml: %v", err)
			return
		}
		var parsed struct {
			Discovery struct {
				Exclude struct {
					Groups    []string `yaml:"groups"`
					Resources []string `yaml:"resources"`
				} `yaml:"exclude"`
			} `yaml:"discovery"`
		}
		if err := yaml.Unmarshal(data, &parsed); err != nil {
			log.Printf("failed to parse kubelens.config.yaml: %v", err)
			return
		}
		discoveryGroups = parsed.Discovery.Exclude.Groups
		discoveryResources = parsed.Discovery.Exclude.Resources
	})
	return discoveryGroups, discoveryResources
}

// A CRD's `kubectl get` target is group-qualified, so it differs from its key.
func isCRD(r ResourceConfig) bool { return r.ResourceType != r.Key }

// GraphResources returns kinds whose `show` includes "graph".
func GraphResources() []ResourceConfig {
	var out []ResourceConfig
	for _, r := range LoadResources() {
		for _, s := range r.Show {
			if s == "graph" {
				out = append(out, r)
				break
			}
		}
	}
	return out
}

// FileAliases derives snapshot filename aliases for CRDs from config.
func FileAliases() map[string][]string {
	out := map[string][]string{}
	for _, r := range LoadResources() {
		if isCRD(r) {
			out[r.Key] = []string{r.ResourceType + ".yaml", r.Key + ".yaml"}
		}
	}
	return out
}
