/**
 * Snapshot loader — reads and caches YAML/text files from k8s-snapshot/.
 * All other snapshot modules depend on this.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const BACKUP_PATH = process.env.K8S_SNAPSHOT_PATH || path.join(__dirname, '..', 'k8s-snapshot');
const DEFAULT_NAMESPACE = 'demo';

const FILE_ALIASES = {
  'httproutes': ['httproutes.gateway.networking.k8s.io.yaml', 'httproutes.yaml'],
  'tcproutes': ['tcproutes.gateway.networking.k8s.io.yaml', 'tcproutes.yaml'],
  'gateways': ['gateways.gateway.networking.k8s.io.yaml', 'gateways.yaml'],
};

const cache = {};

function resolveFilePath(filename, namespace) {
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

function loadYaml(filename, namespace) {
  const cacheKey = `${namespace || '_'}:${filename}`;
  if (cache[cacheKey]) return cache[cacheKey];
  const filePath = resolveFilePath(filename, namespace);
  if (!filePath) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(content);
  cache[cacheKey] = parsed;
  return parsed;
}

function loadText(filename, namespace) {
  const cacheKey = `text:${namespace || '_'}:${filename}`;
  if (cache[cacheKey]) return cache[cacheKey];
  const filePath = resolveFilePath(filename, namespace);
  if (!filePath) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  cache[cacheKey] = content;
  return content;
}

function listBackupNamespaces() {
  if (!fs.existsSync(BACKUP_PATH)) return [DEFAULT_NAMESPACE];
  return fs.readdirSync(BACKUP_PATH, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '_cluster')
    .map(e => e.name);
}

module.exports = {
  BACKUP_PATH,
  DEFAULT_NAMESPACE,
  FILE_ALIASES,
  cache,
  resolveFilePath,
  loadYaml,
  loadText,
  listBackupNamespaces,
};
