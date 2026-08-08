package routes

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// The TypeScript twin is api/utils/tail.spec.ts. The two cut on different units
// — bytes here, UTF-16 code units there — so they share the property, not the
// fixture: never return a string that starts mid-character.
func TestTailBytesKeepsTheEnd(t *testing.T) {
	if got := tailBytes("short", 100); got != "short" {
		t.Errorf("under the limit should pass through, got %q", got)
	}
	if got := tailBytes("abcdefgh", 3); got != "fgh" {
		t.Errorf("got %q, want %q", got, "fgh")
	}
}

// Every cut position, on text that is entirely multi-byte. Two of every three
// byte offsets land inside a character, so a blind slice fails most limits here.
func TestTailBytesNeverSplitsACharacter(t *testing.T) {
	for _, s := range []string{"叢集測試", "ctx-👩-prod", "prod-叢集-👩"} {
		for limit := 1; limit <= len(s); limit++ {
			got := tailBytes(s, limit)

			if !utf8.ValidString(got) {
				t.Errorf("%q limit %d: invalid UTF-8 %q", s, limit, got)
			}
			if len(got) > limit {
				t.Errorf("%q limit %d: returned %d bytes", s, limit, len(got))
			}
			if !strings.HasSuffix(s, got) {
				t.Errorf("%q limit %d: %q is not a suffix", s, limit, got)
			}
		}
	}
}

// The case that motivated this: "叢" is three bytes, so cutting one byte short
// of its boundary leaves "\xa2" in front of the next character.
func TestTailBytesOnTheOriginalFailure(t *testing.T) {
	s := "叢集"
	if blind := s[len(s)-4:]; utf8.ValidString(blind) {
		t.Fatal("the fixture no longer reproduces the bad cut — pick different text")
	}
	if got := tailBytes(s, 4); got != "集" {
		t.Errorf("got %q, want %q", got, "集")
	}
}
