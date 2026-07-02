package store

import (
	"log"
	"os"
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

var (
	resourceCache []ResourceConfig
	resourceOnce  sync.Once

	templateCache map[string][]TemplateEntry
	templateOnce  sync.Once
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
