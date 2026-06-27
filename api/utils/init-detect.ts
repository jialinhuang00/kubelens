/**
 * Pure detection logic for `kubelens init` — kept here (not in scripts/) so it's
 * unit-testable without a live cluster. scripts/init.ts does the kubectl calls
 * and file I/O, then hands the raw output to these functions.
 */

import type { ApiResource } from './api-resources';

export interface ClusterInfo { context: string; type: string; region: string; }

/** Infer cluster type + region from kubeconfig (current-context + cluster.server). */
export function detectCluster(kubeconfig: {
  'current-context'?: string;
  clusters?: Array<{ cluster?: { server?: string } }>;
}): ClusterInfo {
  const context = kubeconfig['current-context'] || '';
  const server = kubeconfig.clusters?.[0]?.cluster?.server || '';
  let type = 'onprem';
  let region = '';
  if (/\.eks\.amazonaws\.com/.test(server)) {
    type = 'eks';
    region = (server.match(/\.([a-z0-9-]+)\.eks\.amazonaws\.com/) || [])[1] || '';
  } else if (/\.gke\.goog|googleapis\.com/.test(server) || /^gke_/.test(context)) {
    // GKE API servers are bare IPs, so the context name (gke_<proj>_<region>_<cluster>) is the tell.
    type = 'gke';
    region = (context.match(/^gke_[^_]+_([^_]+)_/) || [])[1] || '';
  } else if (/\.azmk8s\.io/.test(server)) {
    type = 'aks';
  } else if (/\/\/(127\.0\.0\.1|localhost)\b/.test(server) || /^kind-/.test(context)) {
    type = 'kind';
  } else if (context === 'minikube') {
    type = 'minikube';
  }
  return { context, type, region };
}

export interface RegistryInfo { type: string; votes: Record<string, number>; }

/** Majority-vote the registry from a sample of container image refs. */
export function classifyRegistry(images: string[]): RegistryInfo {
  const votes: Record<string, number> = {};
  for (const img of images) {
    const host = img.split('/')[0];
    let t = 'dockerhub';
    if (/\.dkr\.ecr\..*\.amazonaws\.com/.test(host)) t = 'ecr';
    else if (/(^|\.)gcr\.io$|-docker\.pkg\.dev$/.test(host)) t = 'gcr';
    else if (/\.azurecr\.io$/.test(host)) t = 'acr';
    votes[t] = (votes[t] || 0) + 1;
  }
  const type = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';
  return { type, votes };
}

export interface KnownCrd { label: string; color: string; show: ('tree' | 'graph')[]; }

/** CRDs kubelens has first-class handling for — keyed by `group/Kind`. Gateway API
 *  kinds have topology edges in the graph builder, so they default to graph. */
export const KNOWN_CRDS: Record<string, KnownCrd> = {
  'gateway.networking.k8s.io/Gateway':   { label: 'Gateways',   color: '#6ab0a0', show: ['graph'] },
  'gateway.networking.k8s.io/HTTPRoute': { label: 'HTTPRoutes', color: '#7ab8b8', show: ['graph'] },
  'gateway.networking.k8s.io/TCPRoute':  { label: 'TCPRoutes',  color: '#8ac0c0', show: ['graph'] },
  'argoproj.io/Application':             { label: 'Applications', color: '#e07850', show: ['tree'] },
};

export interface ResourceEntry {
  kind: string; key: string; resourceType: string; namePrefix: string; group: string;
  label: string; color: string; show: ('tree' | 'graph')[]; default: ('tree' | 'graph')[];
}

/** Turn discovered CRDs into config entries: known kinds get their curated
 *  label/colour/views, unknown ones get a neutral tree entry. All ship
 *  `default: []` (capable but off) so a fresh config has no surprise fetches.
 *  `baseIds` is the set of `group/Kind` already in the base config (built-ins) —
 *  skip those. Don't use an "official group" heuristic: Gateway API lives under
 *  *.k8s.io yet is an installable CRD that must be discovered. */
export function buildCrdEntries(
  discovered: ApiResource[],
  baseIds: Set<string>,
  excludeGroups: string[] = [],
  excludeResources: string[] = [],
): ResourceEntry[] {
  const exG = new Set(excludeGroups);
  const exR = new Set(excludeResources);
  const seen = new Set<string>();
  const entries: ResourceEntry[] = [];
  for (const r of discovered) {
    const id = `${r.group}/${r.kind}`;
    if (baseIds.has(id)) continue;                 // already a built-in in kubelens.default.yaml
    if (exG.has(r.group) || exR.has(r.name)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const known = KNOWN_CRDS[id];
    entries.push({
      kind: r.kind, key: r.name, resourceType: r.resourceType, namePrefix: r.resourceType,
      group: r.group, label: known?.label ?? r.kind, color: known?.color ?? '#8a8a8a',
      show: known?.show ?? ['tree'], default: [],
    });
  }
  return entries;
}
