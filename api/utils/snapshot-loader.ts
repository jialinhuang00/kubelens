/**
 * Snapshot loader — reads and caches YAML/text files from k8s-snapshot/.
 * All other snapshot modules depend on this.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/** Standard K8s object metadata. */
export interface K8sMetadata {
  name: string;
  namespace?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  generation?: number;
  ownerReferences?: Array<{ kind: string; name: string }>;
  [key: string]: unknown;
}

/** A single K8s resource (Deployment, Service, ConfigMap, etc.). */
export interface K8sItem {
  apiVersion?: string;
  kind?: string;
  metadata: K8sMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  data?: Record<string, string>;
  type?: string;
  subsets?: Array<{
    addresses?: Array<{ ip: string }>;
    ports?: Array<{ port: number; protocol?: string }>;
  }>;
  roleRef?: { name: string; kind?: string };
  subjects?: Array<{ kind: string; name: string; namespace?: string }>;
  [key: string]: unknown;
}

/** A K8s list response containing multiple items (e.g. DeploymentList). */
export interface K8sList {
  apiVersion?: string;
  kind?: string;
  items: K8sItem[];
}

/** Root directory for snapshot YAML files. Override with K8S_SNAPSHOT_PATH env var. */
export const BACKUP_PATH: string = process.env.K8S_SNAPSHOT_PATH || path.join(__dirname, '..', '..', 'k8s-snapshot');

/** Fallback namespace when none is specified. */
export const DEFAULT_NAMESPACE = 'demo';

/** Filename aliases for resources whose YAML filenames vary (e.g. gateway API CRDs). */
export const FILE_ALIASES: Record<string, string[]> = {
  'httproutes': ['httproutes.gateway.networking.k8s.io.yaml', 'httproutes.yaml'],
  'tcproutes': ['tcproutes.gateway.networking.k8s.io.yaml', 'tcproutes.yaml'],
  'gateways': ['gateways.gateway.networking.k8s.io.yaml', 'gateways.yaml'],
  'virtualservices': ['virtualservices.networking.istio.io.yaml', 'virtualservices.yaml'],
  'destinationrules': ['destinationrules.networking.istio.io.yaml', 'destinationrules.yaml'],
  'serviceentries': ['serviceentries.networking.istio.io.yaml', 'serviceentries.yaml'],
  'applications': ['applications.argoproj.io.yaml', 'applications.yaml'],
};

/** In-memory cache. Key format: `${namespace}:${filename}` for YAML, `text:${namespace}:${filename}` for text. */
export const cache: Record<string, unknown> = {};

/**
 * Resolve a snapshot filename to an absolute path.
 * Checks the namespace subdirectory, then tries FILE_ALIASES.
 * @param filename - e.g. `'deployments.yaml'` or `'pods-snapshot.txt'`
 * @param namespace - K8s namespace (subdirectory under BACKUP_PATH)
 * @returns Absolute file path, or `null` if not found
 */
export function resolveFilePath(filename: string, namespace?: string): string | null {
  if (namespace) {
    const nsDir = path.join(BACKUP_PATH, namespace);
    const nsPath = path.join(nsDir, filename);
    if (fs.existsSync(nsPath)) return nsPath;
    const baseName = filename.replace('.yaml', '');
    const aliases = FILE_ALIASES[baseName];
    if (aliases) {
      for (const alias of aliases) {
        const aliasPath = path.join(nsDir, alias);
        if (fs.existsSync(aliasPath)) return aliasPath;
      }
    }
  }
  return null;
}

/**
 * Load and parse a YAML file from the snapshot directory. Results are cached.
 * @param filename - YAML filename, e.g. `'deployments.yaml'`
 * @param namespace - K8s namespace subdirectory
 * @returns Parsed K8sList, or `null` if file not found
 */
export function loadYaml(filename: string, namespace?: string): K8sList | null {
  const cacheKey = `${namespace || '_'}:${filename}`;
  if (cache[cacheKey]) return cache[cacheKey] as K8sList;
  const filePath = resolveFilePath(filename, namespace);
  if (!filePath) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(content) as K8sList;
  cache[cacheKey] = parsed;
  return parsed;
}

/**
 * Load a text file from the snapshot directory. Results are cached.
 * @param filename - Text filename, e.g. `'pods-snapshot.txt'`
 * @param namespace - K8s namespace subdirectory
 * @returns File content as string, or `null` if file not found
 */
export function loadText(filename: string, namespace?: string): string | null {
  const cacheKey = `text:${namespace || '_'}:${filename}`;
  if (cache[cacheKey]) return cache[cacheKey] as string;
  const filePath = resolveFilePath(filename, namespace);
  if (!filePath) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  cache[cacheKey] = content;
  return content;
}

/**
 * List all namespace directories under BACKUP_PATH.
 * @returns Sorted array of namespace names, or `[DEFAULT_NAMESPACE]` if BACKUP_PATH doesn't exist
 */
export function listBackupNamespaces(): string[] {
  if (!fs.existsSync(BACKUP_PATH)) return [DEFAULT_NAMESPACE];
  return fs.readdirSync(BACKUP_PATH, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '_cluster')
    .map(e => e.name);
}
