import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextEta } from './export-eta';

describe('nextEta', () => {
  it('projects from the pace so far', () => {
    // 20s for 2 of 6 namespaces → 10s each → 40s left.
    const r = nextEta({ minEtaSeconds: null, elapsedSeconds: 20, doneNamespaces: 2, totalNamespaces: 6 });
    assert.equal(r.etaSeconds, 40);
    assert.equal(r.minEtaSeconds, 40);
  });

  it('holds the minimum when a later estimate is higher', () => {
    const r = nextEta({ minEtaSeconds: 40, elapsedSeconds: 60, doneNamespaces: 3, totalNamespaces: 6 });
    assert.equal(r.etaSeconds, 40, 'a rising ETA reads as the export going backwards');
  });

  it('takes the lower estimate', () => {
    const r = nextEta({ minEtaSeconds: 40, elapsedSeconds: 30, doneNamespaces: 3, totalNamespaces: 6 });
    assert.equal(r.etaSeconds, 30);
    assert.equal(r.minEtaSeconds, 30);
  });

  /**
   * The second export of any server session used to arrive here with
   * minEtaSeconds === undefined, because the START handler rebuilt exportState
   * from an object literal that omitted the field. Both halves of the old
   * `min === null || raw < min` guard were false, nothing was assigned, and the
   * ETA disappeared from the response for the rest of the process's life.
   */
  it('treats a missing running minimum as no minimum, not as an unbeatable one', () => {
    const r = nextEta({ minEtaSeconds: undefined, elapsedSeconds: 20, doneNamespaces: 2, totalNamespaces: 6 });
    assert.equal(r.etaSeconds, 40, 'undefined must behave like null here, or the ETA never appears again');
    assert.equal(r.minEtaSeconds, 40);
  });

  it('reports nothing before the first namespace finishes', () => {
    const r = nextEta({ minEtaSeconds: null, elapsedSeconds: 5, doneNamespaces: 0, totalNamespaces: 6 });
    assert.equal(r.etaSeconds, null);
  });

  it('reports zero on the last namespace rather than a stale estimate', () => {
    const r = nextEta({ minEtaSeconds: 40, elapsedSeconds: 60, doneNamespaces: 6, totalNamespaces: 6 });
    assert.equal(r.etaSeconds, 0);
  });
});
