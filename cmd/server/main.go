package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"kubecmds-viz/server/routes"
)

func main() {
	// PROJECT_ROOT lets the server find k8s-snapshot/, scripts/, etc.
	// when invoked from a subdirectory (e.g. via npm run dev:go from cmd/server/).
	if root := os.Getenv("PROJECT_ROOT"); root != "" {
		if err := os.Chdir(root); err != nil {
			log.Fatalf("chdir to PROJECT_ROOT %q: %v", root, err)
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	mux := http.NewServeMux()
	routes.Register(mux)

	fmt.Printf("kubecmds-viz Go server running on http://localhost:%s\n", port)
	fmt.Printf("Realtime ping: http://localhost:%s/api/realtime/ping\n", port)
	fmt.Printf("Graph endpoint: http://localhost:%s/api/graph\n", port)

	log.Fatal(http.ListenAndServe(":"+port, corsMiddleware(mux)))
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
