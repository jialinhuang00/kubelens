import express from 'express';
import type { Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { discoverNamespaces, getItemsFromSnapshot, buildGraph } from '../utils/graph-builder';
import type { K8sItem } from '../utils/snapshot-loader';
import { getGraphResources, isCrd } from '../utils/config-loader';
import { snapshotDir } from '../utils/paths';

const execFileAsync = promisify(execFile);

const router = express.Router();

/** A failed execFile carries the child's output and an abort code on the error. */
interface ExecError extends Error {
  code?: string;
  stderr?: string;
}

/** Only the shape this route reads out of `kubectl get -o json`. */
interface KubectlList {
  items?: K8sItem[];
}

// --- Realtime (kubectl) helpers ---

async function execKubectl(args: string, signal: AbortSignal): Promise<{ data: KubectlList; error: string | null }> {
  try {
    const argList = args.split(/\s+/);
    const { stdout } = await execFileAsync('kubectl', argList, {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
      signal,
    });
    const bytes = Buffer.byteLength(stdout, 'utf8');
    const parsed: KubectlList = JSON.parse(stdout);
    console.log(`[graph] kubectl ${args.split(' -')[0]}: ${(bytes / 1024).toFixed(1)}KB, ${parsed.items?.length ?? 0} items`);
    return { data: parsed, error: null };
  } catch (err) {
    const e = err as ExecError;
    if (e.code === 'ABORT_ERR') return { data: { items: [] }, error: null };
    const stderrLines = [...new Set((e.stderr || '').split('\n').map(l => l.trim()).filter(Boolean))];
    const msg = stderrLines.join('\n') || e.message?.split('\n')[0] || 'Unknown error';
    console.warn(`[graph] kubectl ${args}: ${msg}`);
    return { data: { items: [] }, error: msg };
  }
}

async function fetchLiveData(signal: AbortSignal) {
  const graphResources = getGraphResources();
  const builtins = graphResources.filter(r => !isCrd(r));
  const crds = graphResources.filter(r => isCrd(r));

  // One batch for all built-in types; individual calls for CRDs so a missing
  // CRD doesn't fail the core fetch.
  const batches = [
    builtins.map(r => r.resourceType).join(','),
    ...crds.map(r => r.resourceType),
  ];

  // "group/kind" → internal key, so kinds sharing a Kind name across API groups
  // (e.g. Gateway in gateway.networking.k8s.io vs networking.istio.io) don't collide.
  const groupKindToKey: Record<string, string> = {};
  for (const r of graphResources) groupKindToKey[`${r.group}/${r.kind}`] = r.key;

  const nsData = new Map<string, Map<string, K8sItem[]>>();
  const allNamespaces = new Set<string>();

  function ingest(data: KubectlList) {
    for (const item of data?.items || []) {
      const av = item.apiVersion || '';
      const group = av.includes('/') ? av.slice(0, av.indexOf('/')) : '';
      const key = groupKindToKey[`${group}/${item.kind}`];
      if (!key) continue;
      const ns = item.metadata?.namespace || '_cluster';
      allNamespaces.add(ns);
      if (!nsData.has(ns)) nsData.set(ns, new Map());
      const nsMap = nsData.get(ns)!;
      if (!nsMap.has(key)) nsMap.set(key, []);
      nsMap.get(key)!.push(item);
    }
  }

  const results = await Promise.all(
    batches.map(resources => execKubectl(`get ${resources} -A -o json`, signal))
  );

  for (const r of results) ingest(r.data);

  // Core batch (index 0) failing means kubectl itself is broken.
  if (results[0]?.error) throw new Error(results[0].error);

  return { nsData, namespaces: [...allNamespaces] };
}

// GET /api/graph
router.get('/graph', async (req: Request, res: Response) => {
  const isSnapshot = req.query.snapshot === 'true';

  try {
    if (isSnapshot) {
      // One helper for the whole app, so the export, the loader and this route
      // cannot disagree about where a snapshot lives. It already honours
      // K8S_SNAPSHOT_PATH.
      const dataPath = snapshotDir();

      const namespaceDirs = discoverNamespaces(dataPath);
      const namespaceList = [...namespaceDirs.keys()];

      const getItemsFn = (ns: string, resourceKey: string) => {
        const nsDir = namespaceDirs.get(ns);
        if (!nsDir) return [];
        return getItemsFromSnapshot(nsDir, resourceKey);
      };

      res.json(buildGraph(getItemsFn, namespaceList));
    } else {
      // Abort kubectl processes if client disconnects (e.g. mode switch)
      const ac = new AbortController();
      req.on('close', () => {
        if (!res.writableFinished) {
          console.log('\x1b[31m[graph] Client disconnected — aborting kubectl processes\x1b[0m');
          ac.abort();
        }
      });

      const { nsData, namespaces } = await fetchLiveData(ac.signal);

      const getItemsFn = (ns: string, resourceKey: string) => {
        const nsMap = nsData.get(ns);
        if (!nsMap) return [];
        return nsMap.get(resourceKey) || [];
      };

      res.json(buildGraph(getItemsFn, namespaces));
    }
  } catch (err) {
    const e = err as Error;
    console.error('[graph] Error:', e.message);
    res.status(500).json({ message: e.message || 'Failed to fetch graph data' });
  }
});

export = router;
