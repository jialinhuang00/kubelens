package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

const (
	colorYellow = "\033[33m" // → fetching
	colorGreen  = "\033[32m" // ← done, ✓ completed, banner
	colorRed    = "\033[31m" // errors
	colorReset  = "\033[0m"
)

// nsBatches mirrors the NS_BATCHES array in k8s-export.sh.
// Each element is a comma-separated list of resource types for one kubectl call.
var nsBatches = []string{
	"deployments,statefulsets,daemonsets,cronjobs,jobs",
	"services,ingresses,endpoints",
	"configmaps,secrets,serviceaccounts",
	"persistentvolumeclaims,roles,rolebindings",
	"networkpolicies,horizontalpodautoscalers,poddisruptionbudgets",
	"gateways.gateway.networking.k8s.io,httproutes.gateway.networking.k8s.io,tcproutes.gateway.networking.k8s.io,applications.argoproj.io",
}

// exportAllNamespaces runs namespace exports with a semaphore-bounded worker pool.
func exportAllNamespaces(k8sClient kubernetes.Interface, dynClient dynamic.Interface, namespaces []string, baseDir string, jobs int, resume bool) {
	if len(namespaces) == 0 {
		return
	}

	sem := make(chan struct{}, jobs)
	var wg sync.WaitGroup

	for _, ns := range namespaces {
		ns := ns
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			exportOneNamespace(k8sClient, dynClient, ns, baseDir, resume)
		}()
	}
	wg.Wait()
}

// exportOneNamespace exports all resources for a single namespace.
// Fires 7 goroutines concurrently: 6 resource batches + 1 pods goroutine.
// The pods goroutine fetches pods once and writes pods.yaml, pods-snapshot.txt, pods-images.txt.
func exportOneNamespace(k8sClient kubernetes.Interface, dynClient dynamic.Interface, ns, baseDir string, resume bool) {
	start := time.Now()
	fmt.Printf("%s start\n", ns)

	nsTag := fmt.Sprintf("%-20s", "["+ns+"]")
	nsDir := filepath.Join(baseDir, ns)
	if err := os.MkdirAll(nsDir, 0755); err != nil {
		fmt.Printf("%s  ERROR: mkdir %s: %v%s\n", colorRed, nsDir, err, colorReset)
		return
	}

	var wg sync.WaitGroup

	// 6 batch goroutines — each fetches multiple resource types concurrently within the batch.
	for _, batch := range nsBatches {
		batch := batch
		wg.Add(1)
		go func() {
			defer wg.Done()
			fmt.Printf("%s  → %s fetching %s%s\n", colorYellow, nsTag, batch, colorReset)
			items := fetchBatch(dynClient, ns, batch)
			if _, err := writeBatchResults(nsDir, items, resume); err != nil {
				fmt.Printf("%s  ← %s %s failed: %v%s\n", colorRed, nsTag, batch, err, colorReset)
			} else {
				fmt.Printf("%s  ← %s %s done%s\n", colorGreen, nsTag, batch, colorReset)
			}
		}()
	}

	// Pods goroutine — fetch once with typed client, write three outputs.
	// Typed client gives structured Pod objects needed for table formatting.
	wg.Add(1)
	go func() {
		defer wg.Done()
		fmt.Printf("%s  → %s fetching pods%s\n", colorYellow, nsTag, colorReset)
		podList, err := fetchPodsTyped(k8sClient, ns)
		if err != nil {
			fmt.Printf("%s  ← %s pods failed: %v%s\n", colorRed, nsTag, err, colorReset)
			return
		}

		// pods.yaml — convert to unstructured and write as a List.
		if _, werr := writeBatchResults(nsDir, podsToUnstructured(podList), resume); werr != nil {
			fmt.Printf("%s  ← %s pods failed: %v%s\n", colorRed, nsTag, werr, colorReset)
		} else {
			fmt.Printf("%s  ← %s pods done%s\n", colorGreen, nsTag, colorReset)
		}

		// pods-snapshot.txt
		snapPath := filepath.Join(nsDir, "pods-snapshot.txt")
		if !(resume && fileExists(snapPath)) {
			if err := writeText(snapPath, formatPodsWide(podList)); err != nil {
				fmt.Printf("%s  ← %s pods-snapshot failed: %v%s\n", colorRed, nsTag, err, colorReset)
			}
		}

		// pods-images.txt
		imgPath := filepath.Join(nsDir, "pods-images.txt")
		if !(resume && fileExists(imgPath)) {
			if err := writeText(imgPath, formatPodsImages(podList)); err != nil {
				fmt.Printf("%s  ← %s pods-images failed: %v%s\n", colorRed, nsTag, err, colorReset)
			}
		}
	}()

	wg.Wait()

	touchFile(filepath.Join(nsDir, ".done"))
	elapsed := int(time.Since(start).Seconds())
	fmt.Printf("%s✓ Namespace %s completed in %ds%s\n\n", colorGreen, ns, elapsed, colorReset)
}

// fileExists returns true if path exists and is a regular file.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
