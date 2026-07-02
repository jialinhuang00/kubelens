package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

var version = "dev" // injected at build time via -ldflags

func main() {
	hostname, _ := os.Hostname()
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "service: order-service\nversion: %s\nHostname: %s\n", version, hostname)
	})
	log.Printf("order-service %s listening on :80", version)
	log.Fatal(http.ListenAndServe(":80", nil))
}
