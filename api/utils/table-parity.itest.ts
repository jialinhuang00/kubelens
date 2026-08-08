import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PKG_ROOT } from './paths';
import { loadTables, getResourceFileMap, getNamePrefixMap } from './config-loader';
import { handleCommand } from './snapshot-handler';
import { renderTable } from './snapshot-parsers';

/**
 * The two backends render Snapshot mode's `kubectl get` tables from the same
 * `tables:` section of kubelens.config.yaml, in different languages. Go had no
 * struct for that section at all until 2026-08-07 and rendered seven
 * hand-written tables instead, so nine kinds came back as a bare list of names
 * on `dev:go` and editing the config changed nothing there.
 *
 * Nothing caught it because each backend's tests only ever compared it against
 * itself. So this renders the same items through both and compares the text.
 * Neither side has a written-down expected table: the only claim is that they
 * agree, which is the claim that was false.
 *
 * The kind list comes from the config, so a kind added there with no fixture
 * fails rather than passing by not being covered.
 *
 * `.itest.ts` because it shells out to `go run`. Needs a Go toolchain, skips
 * without one.
 */

function usable(binary: string, probeArgs: string[]): boolean {
  try {
    execFileSync(binary, probeArgs, { stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const FIXTURE = path.join(PKG_ROOT, 'test-fixtures', 'table-items.json');

/** A throwaway main that renders every fixture through store.RenderTable. */
const PROBE = `package main

import (
	"encoding/json"
	"fmt"
	"os"

	"kubelens/server/store"
)

func main() {
	// The server chdirs to PROJECT_ROOT before serving, and store.LoadTables
	// reads "kubelens.config.yaml" relative to the working directory. \`go -C\`
	// leaves the child in cmd/server, where there is none — and LoadTables logs
	// that to stderr and returns an empty map, which reads downstream as "Go
	// renders every table differently" rather than "Go read no config".
	if err := os.Chdir(os.Args[2]); err != nil {
		panic(err)
	}

	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var items map[string]store.K8sItem
	if err := json.Unmarshal(raw, &items); err != nil {
		panic(err)
	}

	tables := store.LoadTables()
	if len(tables) == 0 {
		panic("store.LoadTables() is empty — the probe is not reading kubelens.config.yaml")
	}

	out := map[string]string{}
	for kind, item := range items {
		spec, ok := tables[kind]
		if !ok {
			continue
		}
		out[kind] = store.RenderTable(spec, []store.K8sItem{item})
	}
	// -o name is what the Terminal sidebar calls to list a namespace's resources.
	// This backend had no path for it at all until 2026-08-08.
	names := store.HandleCommand("kubectl get deployments,services,configmaps -n demo -o name")
	// Aliases and the snapshot-only kinds: "ep" must answer "endpoints/x", the
	// canonical prefix, not the alias the caller typed.
	aliasNames := store.HandleCommand("kubectl get ep -n demo -o name")

	b, _ := json.Marshal(map[string]any{
		"tables":   out,
		"files":    store.ResourceFileMap(),
		"prefixes": store.NamePrefixMap(),
		"names":      names.Stdout,
		"aliasNames": aliasNames.Stdout,
	})
	fmt.Print(string(b))
}
`;

describe('the two backends render the same table from the same config', () => {
  if (!usable('go', ['version'])) {
    it('skipped: no Go toolchain', { skip: true }, () => {});
  } else {
    const items: Record<string, Record<string, unknown>> = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const kinds = Object.keys(loadTables());

    const probeDir = path.join(PKG_ROOT, 'cmd', 'server', 'cmd', 'table-probe');
    let probe: {
      tables: Record<string, string>;
      files: Record<string, string>;
      prefixes: Record<string, string>;
      names: string;
      aliasNames: string;
    } = { tables: {}, files: {}, prefixes: {}, names: '', aliasNames: '' };
    try {
      fs.mkdirSync(probeDir, { recursive: true });
      fs.writeFileSync(path.join(probeDir, 'main.go'), PROBE);
      probe = JSON.parse(execFileSync('go', [
        '-C', path.join(PKG_ROOT, 'cmd', 'server'), 'run', './cmd/table-probe', FIXTURE, PKG_ROOT,
      ], { encoding: 'utf8', timeout: 180_000 }));
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
    }
    const goTables = probe.tables;

    it('resolves every kubectl name and alias to the same file', () => {
      // Go's map was hardcoded and had never heard of daemonsets, ingresses,
      // horizontalpodautoscalers or networkpolicies, so `kubectl get ds` on
      // dev:go answered "Unknown resource type" while Node printed a table.
      // Both sides now build it from the config's `resources:` entries.
      assert.deepEqual(probe.files, getResourceFileMap());
    });

    it('maps every name and alias to the same `-o name` prefix', () => {
      assert.deepEqual(probe.prefixes, getNamePrefixMap());
    });

    it('answers `-o name` the same way, including the comma-joined batch form', () => {
      // The sidebar sends one comma-joined request per namespace and reads
      // `<prefix>/<name>` back. Go used to fall through to a table here, so the
      // sidebar under dev:go could not expand anything — and every backend test
      // was green, because none of them asked this backend for `-o name`.
      const node = handleCommand('kubectl get deployments,services,configmaps -n demo -o name');
      assert.equal(probe.names, node.stdout);
      assert.match(probe.names, /^\w[\w.]*\/\S+$/m, `not <prefix>/<name>: ${JSON.stringify(probe.names)}`);
    });

    it('resolves an alias to the canonical `-o name` prefix, on both sides', () => {
      // `kubectl get ep -o name` answers `endpoints/gateway` — the alias never
      // appears in the output. Node used to echo whatever the caller typed
      // (`ep/gateway`) because Endpoints has no `resources:` entry to take a
      // namePrefix from, and Go did not recognise the kind at all.
      const node = handleCommand('kubectl get ep -n demo -o name');
      assert.equal(probe.aliasNames, node.stdout);
      if (probe.aliasNames) {
        assert.doesNotMatch(probe.aliasNames, /^ep\//m, `alias leaked into output: ${probe.aliasNames}`);
        assert.match(probe.aliasNames, /^endpoints\/\S+$/m);
      }
    });

    it('has a fixture for every kind the config declares a table for', () => {
      const missing = kinds.filter((k) => !(k in items));
      assert.deepEqual(missing, [],
        `no fixture item for ${missing.join(', ')} — run: node scripts/capture-table-fixtures.js`);
    });

    for (const kind of kinds) {
      it(`${kind}: same table from Node and Go`, () => {
        const spec = loadTables()[kind];
        const node = renderTable(spec, [items[kind] as never]);
        assert.equal(
          goTables[kind],
          node,
          `${kind} renders differently.\n--- Go ---\n${goTables[kind]}\n--- Node ---\n${node}`,
        );
      });
    }
  }
});
