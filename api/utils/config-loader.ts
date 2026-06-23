import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface ResourceConfig {
  kind: string;
  key: string;
  resourceType: string;
  namePrefix: string;
  group: string;
  label: string;
  color: string;
  priority?: boolean;
  show: ('tree' | 'graph')[];
}

const CONFIG_PATH = path.join(__dirname, '../..', 'kubelens.config.yaml');

interface ConfigDoc {
  resources?: ResourceConfig[];
  discovery?: { exclude?: { groups?: string[]; resources?: string[] } };
}

let docCache: ConfigDoc | null = null;

/** Read and cache the whole kubelens.config.yaml. */
function loadDoc(): ConfigDoc {
  if (docCache) return docCache;
  try {
    docCache = (yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) as ConfigDoc) ?? {};
  } catch (e) {
    console.error('Failed to load kubelens.config.yaml:', (e as Error).message);
    docCache = {};
  }
  return docCache;
}

export function loadResources(): ResourceConfig[] {
  return loadDoc().resources ?? [];
}

/** Groups/resources to hide from cluster discovery (pure plumbing). */
export function getDiscoveryExclude(): { groups: string[]; resources: string[] } {
  const ex = loadDoc().discovery?.exclude ?? {};
  return { groups: ex.groups ?? [], resources: ex.resources ?? [] };
}

/** A CRD's `kubectl get` target is group-qualified, so it differs from its key. */
export function isCrd(r: ResourceConfig): boolean {
  return r.resourceType !== r.key;
}

export function getGraphResources(): ResourceConfig[] {
  return loadResources().filter(r => r.show?.includes('graph'));
}

/**
 * Snapshot filename aliases for CRDs, whose YAML file is named with the full
 * group (e.g. `applications.argoproj.io.yaml`) but may also appear bare.
 */
export function getFileAliases(): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const r of loadResources()) {
    if (isCrd(r)) aliases[r.key] = [`${r.resourceType}.yaml`, `${r.key}.yaml`];
  }
  return aliases;
}
