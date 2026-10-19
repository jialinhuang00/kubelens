package main

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	"kubelens/server/routes"
)

func main() {
	// PROJECT_ROOT lets the server find k8s-snapshot/, scripts/, etc.
	// when invoked from a subdirectory (e.g. via npm run dev:go from cmd/server/).
	if root := os.Getenv("PROJECT_ROOT"); root != "" {
		if err := os.Chdir(root); err != nil {
			log.Fatalf("chdir to PROJECT_ROOT %q: %v", root, err)
		}
	}

	loadDotEnv(".env")

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	// Loopback only unless asked, same as api/index.ts: every request here runs
	// kubectl with the user's kubeconfig. HOST=0.0.0.0 opts in.
	host := os.Getenv("HOST")
	if host == "" {
		host = "127.0.0.1"
	}

	mux := http.NewServeMux()
	routes.Register(mux)

	fmt.Printf("kubelens Go server running on http://localhost:%s (bound to %s)\n", port, host)
	fmt.Printf("Realtime ping: http://localhost:%s/api/realtime/ping\n", port)
	fmt.Printf("Graph endpoint: http://localhost:%s/api/graph\n", port)

	policy := routes.HostPolicyFromEnv()
	if policy.Open {
		log.Printf("Host check is off: bound to %s with no KUBELENS_ALLOWED_HOSTS. Any DNS name pointed at this machine reaches kubectl.", host)
	}

	// No CORS headers: the frontend is same-origin (served here, or through the
	// ng serve proxy), and "Allow-Origin: *" let any site POST commands.
	// The Host guard wraps everything, the WebSocket upgrade included.
	log.Fatal(http.ListenAndServe(net.JoinHostPort(host, port), policy.Guard(mux)))
}

// loadDotEnv reads a .env file and sets any vars not already in the environment.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // missing .env is fine
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		// Don't override existing env vars
		if os.Getenv(k) == "" {
			os.Setenv(k, v)
		}
	}
}
