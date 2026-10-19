package routes

import (
	"net/http/httptest"
	"testing"
)

func TestOriginAllowed(t *testing.T) {
	cases := []struct {
		name, host, origin string
		want               bool
	}{
		{"no origin (curl, wscat)", "127.0.0.1:3042", "", true},
		{"own page", "localhost:3042", "http://localhost:3042", true},
		{"ng serve proxy keeps Host", "localhost:4200", "http://localhost:4200", true},
		{"other site", "127.0.0.1:3042", "https://evil.example", false},
		{"same host, other port", "localhost:3042", "http://localhost:4200", false},
		{"garbage origin", "localhost:3042", "::not a url", false},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", "/api/execute/stream/ws", nil)
		r.Host = c.host
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		if got := originAllowed(r); got != c.want {
			t.Errorf("%s: originAllowed = %v, want %v", c.name, got, c.want)
		}
	}
}
