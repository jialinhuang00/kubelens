import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PKG_ROOT, userRoot, resolveDataPath, userDataPath, snapshotDir } from './paths';
import { backupPath } from './snapshot-loader';

/**
 * The state these tests care about is the one that used to split readers from
 * writers: `<cwd>/k8s-snapshot` missing while `PKG_ROOT/k8s-snapshot` exists.
 * That is the shape of a server started from a subdirectory of the checkout,
 * and the only shape where the old read-side fallback fired.
 */
let tmpRoot: string;
let prevCwd: string;
let prevSnapshotEnv: string | undefined;
let createdPkgSnapshot = false;

const pkgSnapshot = path.join(PKG_ROOT, 'k8s-snapshot');

before(() => {
  prevCwd = process.cwd();
  // `test:utils` sets this, and snapshotDir() honours it above everything else.
  // These tests are about what happens without it, so clear it and put it back.
  prevSnapshotEnv = process.env.K8S_SNAPSHOT_PATH;
  delete process.env.K8S_SNAPSHOT_PATH;

  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kubelens-paths-')));
  // The fallback needs something to fall back to. Only create it if the
  // checkout has no export of its own — never touch a real one.
  if (!fs.existsSync(pkgSnapshot)) {
    fs.mkdirSync(pkgSnapshot, { recursive: true });
    createdPkgSnapshot = true;
  }
  process.chdir(tmpRoot);
});

after(() => {
  process.chdir(prevCwd);
  if (prevSnapshotEnv === undefined) delete process.env.K8S_SNAPSHOT_PATH;
  else process.env.K8S_SNAPSHOT_PATH = prevSnapshotEnv;
  if (createdPkgSnapshot) fs.rmSync(pkgSnapshot, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('snapshot path resolution', () => {
  it('is the same directory for the export route and the snapshot loader', () => {
    // These were `userDataPath` and `resolveDataPath` respectively. From a
    // subdirectory they answered differently, so an export wrote to
    // <cwd>/k8s-snapshot while Snapshot mode kept reading the checkout's copy:
    // the panel said "Export complete", the data never changed, and nothing
    // errored.
    assert.equal(snapshotDir(), backupPath());
  });

  it('stays under the working directory even when the package has a snapshot', () => {
    assert.ok(fs.existsSync(pkgSnapshot), 'fixture: the package copy has to exist for this to mean anything');
    assert.equal(fs.existsSync(path.join(tmpRoot, 'k8s-snapshot')), false);

    assert.equal(snapshotDir(), path.join(tmpRoot, 'k8s-snapshot'));
    assert.notEqual(snapshotDir(), pkgSnapshot);
  });

  it('honours K8S_SNAPSHOT_PATH, which is how the test suite steers the loader', () => {
    const prev = process.env.K8S_SNAPSHOT_PATH;
    process.env.K8S_SNAPSHOT_PATH = '/somewhere/else';
    try {
      assert.equal(snapshotDir(), '/somewhere/else');
      assert.equal(backupPath(), '/somewhere/else');
    } finally {
      if (prev === undefined) delete process.env.K8S_SNAPSHOT_PATH;
      else process.env.K8S_SNAPSHOT_PATH = prev;
    }
  });
});

describe('resolveDataPath', () => {
  it('still falls back to the package, which is what config seeding needs', () => {
    // kubelens.default.yaml only ever exists in the package. Losing this
    // fallback would break `kubelens init` and the first-run seed.
    const seed = resolveDataPath('kubelens.default.yaml');
    assert.equal(seed, path.join(PKG_ROOT, 'kubelens.default.yaml'));
  });

  it('prefers the working directory when the file exists there', () => {
    fs.writeFileSync(path.join(tmpRoot, 'kubelens.config.yaml'), 'version: "1"\n');
    assert.equal(resolveDataPath('kubelens.config.yaml'), path.join(tmpRoot, 'kubelens.config.yaml'));
  });

  it('resolves a name that exists nowhere against the working directory', () => {
    assert.equal(resolveDataPath('nothing-here.yaml'), path.join(tmpRoot, 'nothing-here.yaml'));
  });
});

describe('userRoot', () => {
  it('follows chdir rather than reporting where the process started', () => {
    // It was `export const USER_ROOT = process.cwd()`, read once at import.
    // Every path built from it froze too, which is why the route spec could not
    // import the route at the top of the file.
    assert.equal(userRoot(), tmpRoot);
    assert.equal(userDataPath('x'), path.join(tmpRoot, 'x'));
  });
});
