package routes

import (
	"net"
	"net/http"
	"os"
	"strings"
)

// HostPolicy is the Go side of api/utils/host-guard.ts. A page that points its
// own DNS name at 127.0.0.1 passes the Origin check (Origin and Host agree on
// the attacker name), so every request must also carry a Host we expect.
type HostPolicy struct {
	allowed map[string]bool
	// Open: bound to every interface with no allowlist, so the check is off.
	Open bool
}

var wildcard = map[string]bool{"0.0.0.0": true, "::": true, "[::]": true}

// NewHostPolicy reads the bind address and KUBELENS_ALLOWED_HOSTS.
func NewHostPolicy(bind, allowList string) HostPolicy {
	bind = strings.ToLower(bind)
	if bind == "" {
		bind = "127.0.0.1"
	}
	p := HostPolicy{allowed: map[string]bool{"localhost": true, "127.0.0.1": true, "::1": true}}
	extra := 0
	for _, h := range strings.Split(allowList, ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			p.allowed[strings.Trim(h, "[]")] = true
			extra++
		}
	}
	if !wildcard[bind] {
		p.allowed[strings.Trim(bind, "[]")] = true
	}
	// Same trade-off as the Node server: 0.0.0.0 without a list means "reach me
	// by whatever name points here", which cannot be checked. main.go warns.
	p.Open = wildcard[bind] && extra == 0
	return p
}

// HostPolicyFromEnv uses HOST and KUBELENS_ALLOWED_HOSTS.
func HostPolicyFromEnv() HostPolicy {
	return NewHostPolicy(os.Getenv("HOST"), os.Getenv("KUBELENS_ALLOWED_HOSTS"))
}

// Allows reports whether a Host header ("localhost:3042", "[::1]:3042") is ours.
func (p HostPolicy) Allows(hostHeader string) bool {
	if p.Open {
		return true
	}
	if hostHeader == "" {
		return false
	}
	name := hostHeader
	if h, _, err := net.SplitHostPort(hostHeader); err == nil {
		name = h
	}
	return p.allowed[strings.ToLower(strings.Trim(name, "[]"))]
}

// Guard refuses any request, the WebSocket upgrade included, whose Host is not ours.
func (p HostPolicy) Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !p.Allows(r.Host) {
			http.Error(w, "Host "+r.Host+" is not allowed. Set KUBELENS_ALLOWED_HOSTS to reach kubelens by this name.", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
