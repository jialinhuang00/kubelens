package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHostPolicy(t *testing.T) {
	cases := []struct {
		name, bind, list, host string
		want                   bool
	}{
		{"default, localhost", "", "", "localhost:3042", true},
		{"default, ipv6 loopback", "", "", "[::1]:3042", true},
		{"default, DNS rebinding name", "", "", "evil.example:3042", false},
		{"default, no Host", "", "", "", false},
		{"specific bind is ours", "192.168.0.10", "", "192.168.0.10:3042", true},
		{"allowlist name", "0.0.0.0", "kubelens.example.com,203.0.113.5", "203.0.113.5:8080", true},
		{"allowlist refuses others", "0.0.0.0", "kubelens.example.com", "evil.example:8080", false},
		{"0.0.0.0 without list is open", "0.0.0.0", "", "anything:8080", true},
	}
	for _, c := range cases {
		if got := NewHostPolicy(c.bind, c.list).Allows(c.host); got != c.want {
			t.Errorf("%s: Allows(%q) = %v, want %v", c.name, c.host, got, c.want)
		}
	}
}

func TestHostGuardBlocksRebinding(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	h := NewHostPolicy("", "").Guard(ok)

	for host, want := range map[string]int{"127.0.0.1:3000": 200, "evil.example:3000": 403} {
		r := httptest.NewRequest("POST", "/api/execute", nil)
		r.Host = host
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Errorf("Host %s: status %d, want %d", host, w.Code, want)
		}
	}
}
