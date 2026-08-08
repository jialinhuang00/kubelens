import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tailChars } from './tail';

// The Go twin of these cases lives in cmd/server/routes/tail_test.go. The two
// implementations cut on different units — UTF-16 code units here, bytes there
// — so they cannot share a fixture, only the property: never return a string
// that ends up with half a character at the front.
describe('tailChars', () => {
  it('returns the whole string when it is under the limit', () => {
    assert.equal(tailChars('short', 100), 'short');
    assert.equal(tailChars('exact', 5), 'exact');
  });

  it('keeps the end, not the start', () => {
    assert.equal(tailChars('abcdefgh', 3), 'fgh');
  });

  it('never splits an emoji into an orphan surrogate', () => {
    // '👩' is two UTF-16 units. A cut between them leaves \uDC69, which renders
    // as a replacement glyph. The kubectl context is a user-chosen name, so it
    // can contain one.
    const s = 'ctx-👩-prod';
    for (let limit = 1; limit <= s.length; limit++) {
      const out = tailChars(s, limit);
      assert.ok(
        !(out.charCodeAt(0) >= 0xdc00 && out.charCodeAt(0) <= 0xdfff),
        `limit ${limit} left an orphan surrogate: ${JSON.stringify(out)}`,
      );
      assert.ok(out.length <= limit, `limit ${limit} returned ${out.length} units`);
      assert.ok(s.endsWith(out), `limit ${limit} returned something that is not a suffix`);
    }
  });

  it('leaves CJK alone — one code unit each, no cut can split them', () => {
    assert.equal(tailChars('叢集測試', 2), '測試');
    assert.equal(tailChars('叢集測試', 3), '集測試');
  });
});
