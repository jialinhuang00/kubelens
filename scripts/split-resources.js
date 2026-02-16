#!/usr/bin/env node
// split-resources.js — Reads a combined kubectl JSON list from stdin,
// splits by Kind, and writes each to a separate .yaml file.

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const resume = process.argv[3] === 'true';
const kindMapPath = path.join(__dirname, 'kind-map.json');
const kindMap = JSON.parse(fs.readFileSync(kindMapPath, 'utf8'));

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const data = JSON.parse(input || '{"items":[]}');
  const byKind = {};

  for (const item of (data.items || [])) {
    const k = item.kind;
    if (!byKind[k]) byKind[k] = [];
    byKind[k].push(item);
  }

  for (const [kind, items] of Object.entries(byKind)) {
    const fname = kindMap[kind] || kind.toLowerCase() + 's';
    const fpath = path.join(dir, fname + '.yaml');

    if (resume && fs.existsSync(fpath)) {
      console.log('  ' + fname + ' (exists, skipped)');
      continue;
    }

    const out = JSON.stringify({ apiVersion: 'v1', kind: 'List', items }, null, 2);
    fs.writeFileSync(fpath + '.tmp', out);
    fs.renameSync(fpath + '.tmp', fpath);
    console.log('  ' + fname + ' (' + items.length + ' objects, done)');
  }
});
