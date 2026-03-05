package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

// stringSlice is a repeatable flag value for -n.
type stringSlice []string

func (s *stringSlice) String() string { return strings.Join(*s, ",") }
func (s *stringSlice) Set(v string) error {
	*s = append(*s, v)
	return nil
}

func main() {
	jobs := flag.Int("jobs", 3, "parallel namespace workers")
	resume := flag.Bool("resume", false, "skip completed namespaces")
	clusterScoped := flag.Bool("cluster-scoped", false, "also export cluster-scoped resources (not yet implemented)")
	var nsFlag stringSlice
	flag.Var(&nsFlag, "n", "namespace (repeatable)")
	flag.Parse()

	_ = clusterScoped // reserved for future implementation

	// Base directory: always relative to cwd (Node.js sets cwd to project root).
	baseDir := "k8s-snapshot"
	if bd := os.Getenv("K8S_SNAPSHOT_DIR"); bd != "" {
		baseDir = bd
	}

	// Load kubeconfig.
	kubeconfig := os.Getenv("KUBECONFIG")
	if kubeconfig == "" {
		home, _ := os.UserHomeDir()
		kubeconfig = filepath.Join(home, ".kube", "config")
	}

	cfg, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: failed to load kubeconfig: %v\n", err)
		os.Exit(1)
	}

	// Raise client-side rate limit. Default is QPS=5, Burst=10 — far too low
	// for parallel namespace export. bash avoids this because each kubectl
	// process has its own independent rate limiter.
	cfg.QPS = 100
	cfg.Burst = 200

	k8sClient, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: failed to create k8s client: %v\n", err)
		os.Exit(1)
	}

	dynClient, err := dynamic.NewForConfig(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: failed to create dynamic client: %v\n", err)
		os.Exit(1)
	}

	// Get current context name for preflight display.
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	loadingRules.ExplicitPath = kubeconfig
	rawCfg, _ := loadingRules.Load()
	ctxName := ""
	if rawCfg != nil {
		ctxName = rawCfg.CurrentContext
	}

	// Discover namespaces if -n not specified.
	namespaces := []string(nsFlag)
	if len(namespaces) == 0 {
		fmt.Println("Checking cluster connection...")
		nsList, err := k8sClient.CoreV1().Namespaces().List(context.Background(), metav1.ListOptions{})
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: Cannot connect to cluster. Run 'aws sso login' and update kubeconfig first.\n%v\n", err)
			os.Exit(1)
		}
		for _, ns := range nsList.Items {
			namespaces = append(namespaces, ns.Name)
		}
		fmt.Printf("Discovered %d namespaces\n", len(namespaces))
	}

	// Preflight.
	fmt.Printf("Cluster context: %s\n", ctxName)
	fmt.Printf("Export target:   %s\n", baseDir)
	fmt.Printf("Namespaces:      %s\n", strings.Join(namespaces, " "))
	fmt.Printf("Parallel jobs:   %d\n", *jobs)
	fmt.Println()

	startTime := time.Now()

	if *resume {
		// Remove .export-complete and leftover .tmp files, then skip completed namespaces.
		os.Remove(filepath.Join(baseDir, ".export-complete"))
		cleanTmpFiles(baseDir)

		remaining := namespaces[:0]
		total := len(namespaces)
		for _, ns := range namespaces {
			doneFile := filepath.Join(baseDir, ns, ".done")
			if _, err := os.Stat(doneFile); err == nil {
				fmt.Printf("=== Namespace: %s === (complete, skipping)\n", ns)
			} else {
				remaining = append(remaining, ns)
			}
		}
		namespaces = remaining
		fmt.Printf("Resuming: %d remaining out of %d namespaces\n\n", len(namespaces), total)
	} else {
		os.RemoveAll(baseDir)
	}

	// Run export.
	exportAllNamespaces(k8sClient, dynClient, namespaces, baseDir, *jobs, *resume)

	// Touch .export-complete.
	touchFile(filepath.Join(baseDir, ".export-complete"))

	// Summary.
	elapsed := int(time.Since(startTime).Seconds())
	fileCount := countFilesSync(baseDir)
	size := dirSizeHuman(baseDir)

	fmt.Println("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557")
	fmt.Println("\u2551  Export Complete                                         \u2551")
	fmt.Println("\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563")
	fmt.Printf("\u2551  Files: %d files\n", fileCount)
	fmt.Printf("\u2551  Size:  %s\n", size)
	fmt.Printf("\u2551  Time:  %ds\n", elapsed)
	fmt.Println("\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d")
}

// --- utility helpers ---

func touchFile(path string) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	f.Close()
	os.Chtimes(path, time.Now(), time.Now())
}

func cleanTmpFiles(dir string) {
	filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() && strings.HasSuffix(path, ".tmp") {
			os.Remove(path)
		}
		return nil
	})
}

func countFilesSync(dir string) int {
	count := 0
	filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if !d.IsDir() && !strings.HasPrefix(name, ".") && !strings.HasSuffix(name, ".tmp") {
			count++
		}
		return nil
	})
	return count
}

func dirSizeHuman(dir string) string {
	var total int64
	filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err == nil {
			total += info.Size()
		}
		return nil
	})
	switch {
	case total < 1024:
		return fmt.Sprintf("%dB", total)
	case total < 1024*1024:
		return fmt.Sprintf("%.1fK", float64(total)/1024)
	case total < 1024*1024*1024:
		return fmt.Sprintf("%.1fM", float64(total)/1024/1024)
	default:
		return fmt.Sprintf("%.1fG", float64(total)/1024/1024/1024)
	}
}
