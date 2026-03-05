package main

import (
	"fmt"
	"os"
	"path/filepath"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	sigsyaml "sigs.k8s.io/yaml"
)

// writeBatchResults groups items by Kind and writes one YAML file per Kind.
// Each file is a v1 List wrapping the items.
// Returns (filesWritten int, err error).
func writeBatchResults(nsDir string, items []unstructured.Unstructured, resume bool) (int, error) {
	// Group by kind.
	byKind := map[string][]unstructured.Unstructured{}
	for _, item := range items {
		k := item.GetKind()
		byKind[k] = append(byKind[k], item)
	}

	written := 0
	for kind, kindItems := range byKind {
		fname := kindToFilename(kind)
		fpath := filepath.Join(nsDir, fname+".yaml")

		if resume {
			if _, err := os.Stat(fpath); err == nil {
				continue // already exists
			}
		}

		data, err := marshalList(kindItems)
		if err != nil {
			return written, fmt.Errorf("marshal %s: %w", kind, err)
		}
		if err := atomicWrite(fpath, data); err != nil {
			return written, fmt.Errorf("write %s: %w", fpath, err)
		}
		written++
	}
	return written, nil
}

// writeText atomically writes plain text to path.
func writeText(path, content string) error {
	return atomicWrite(path, []byte(content))
}

// atomicWrite writes data to path via a .tmp sibling and renames.
func atomicWrite(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// k8sList is the structure we marshal as YAML for each kind file.
type k8sList struct {
	APIVersion string        `json:"apiVersion"`
	Kind       string        `json:"kind"`
	Items      []interface{} `json:"items"`
}

// marshalList serialises items as a v1 List YAML (matching js-yaml output).
// managedFields are stripped — they're server-side apply bookkeeping, not useful in snapshots.
func marshalList(items []unstructured.Unstructured) ([]byte, error) {
	raw := make([]interface{}, len(items))
	for i, item := range items {
		obj := item.DeepCopy()
		unstructured.RemoveNestedField(obj.Object, "metadata", "managedFields")
		raw[i] = obj.Object
	}
	list := k8sList{
		APIVersion: "v1",
		Kind:       "List",
		Items:      raw,
	}
	return sigsyaml.Marshal(list)
}
