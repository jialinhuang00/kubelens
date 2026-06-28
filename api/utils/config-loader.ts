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
  show: ('tree' | 'graph')[];         // capability: which views this kind CAN appear in
  default?: ('tree' | 'graph')[];     // default-on views (subset of show); absent = same as show
  aliases?: string[];                 // kubectl short names, e.g. svc, deploy, cm
}

export interface TemplateDef {
  name: string;
  command: string;
  requiresInput?: boolean;
  disabled?: boolean;
}

const CONFIG_PATH = path.join(__dirname, '../..', 'kubelens.config.yaml');
const DEFAULT_PATH = path.join(__dirname, '../..', 'kubelens.default.yaml');

interface ConfigDoc {
  resources?: ResourceConfig[];
  discovery?: { exclude?: { groups?: string[]; resources?: string[] } };
  templates?: Record<string, TemplateDef[]>;
}

let docCache: ConfigDoc | null = null;
let defaultDocCache: ConfigDoc | null = null;

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

/** Read and cache kubelens.default.yaml (holds the universal per-kind command templates). */
function loadDefaultDoc(): ConfigDoc {
  if (defaultDocCache) return defaultDocCache;
  try {
    defaultDocCache = (yaml.load(fs.readFileSync(DEFAULT_PATH, 'utf8')) as ConfigDoc) ?? {};
  } catch (e) {
    console.error('Failed to load kubelens.default.yaml:', (e as Error).message);
    defaultDocCache = {};
  }
  return defaultDocCache;
}

export function loadResources(): ResourceConfig[] {
  return loadDoc().resources ?? [];
}

/** Per-kind command templates (universal), keyed by Kind. From kubelens.default.yaml;
 *  config.yaml may override per kind. */
export function loadTemplates(): Record<string, TemplateDef[]> {
  return { ...loadDefaultDoc().templates, ...loadDoc().templates };
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
 * Map every resource name + short alias (plural key, singular kind, kubectl
 * shortnames) to its snapshot filename `<key>.yaml`. Derived from config so the
 * snapshot kubectl emulator's vocabulary stays in sync — add a kind once, in config.
 */
export function getResourceFileMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of loadResources()) {
    const file = `${r.key}.yaml`;
    map[r.key] = file;                // plural, e.g. deployments
    map[r.kind.toLowerCase()] = file; // singular, e.g. deployment
    for (const a of r.aliases ?? []) map[a] = file;
  }
  return map;
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
