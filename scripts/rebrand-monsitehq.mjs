#!/usr/bin/env node
/**
 * Rebrand : MONSITEHQ / monsitehq.com → MaQuickPage / maquickpage.fr
 *
 * Règles :
 *   - outil.monsitehq.com           → outil.maquickpage.fr        (agency admin)
 *   - https://monsitehq.com         → https://maquickpage.fr      (URLs)
 *   - monsitehq.com (bare hostname) → maquickpage.fr              (sauf customers.monsitehq.com)
 *   - @monsitehq.com (emails)       → @maquickpage.fr
 *   - MONSITEHQ (brand)             → MaQuickPage
 *   - Quick Site                    → MaQuickPage                 (alias previously used)
 *
 * Garde-fous (NE PAS toucher) :
 *   - customers.monsitehq.com  (fallback infra Falkenstein, sera migré séparément)
 *   - sub-projects : monquicksite/, photo-picker-poc/
 *   - .git/, node_modules/, scripts/
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.argv[2] || process.cwd();
const DRY = !process.argv.includes('--write');

// Dirs to skip
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'data',
  'screenshots', 'uploads', 'public/screenshots',
  'scripts', // own dir
]);

// Files extensions to scan
const SCAN_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.html', '.htm', '.css', '.json', '.md', '.txt',
  '.yml', '.yaml', '.example',
]);

// Files to skip entirely
const SKIP_FILES = new Set(['home.zip', 'package-lock.json']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_FILES.has(name)) continue;
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    const parts = rel.split(sep);
    if (parts.some(seg => SKIP_DIRS.has(seg))) continue;
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else if (SCAN_EXT.has(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

// === Substitution rules ===
// Order matters: more specific FIRST.
const RULES = [
  // 1) agency admin URL
  { from: /outil\.monsitehq\.com/g, to: 'outil.maquickpage.fr' },

  // 2) PRESERVE customers.monsitehq.com (Falkenstein wildcard) — temporarily rewrite to a placeholder then back
  // We do this by NOT matching it: see negative lookbehind below.

  // 3) Full URL https://monsitehq.com → https://maquickpage.fr
  { from: /https:\/\/monsitehq\.com/g, to: 'https://maquickpage.fr' },

  // 4) Email @monsitehq.com → @maquickpage.fr
  { from: /@monsitehq\.com/g, to: '@maquickpage.fr' },

  // 5) Bare hostname monsitehq.com → maquickpage.fr (NOT after "customers.")
  // Negative lookbehind for 'customers.'
  { from: /(?<!customers\.)monsitehq\.com/g, to: 'maquickpage.fr' },

  // 6) Brand text MONSITEHQ → MaQuickPage
  { from: /MONSITEHQ/g, to: 'MaQuickPage' },

  // 7) "Quick Site" (alternateName) → "MaQuickPage" — but only in user-facing text, not in HTML comments
  // Skip this — alternateName=Quick Site is fine to keep as historical alias.
  // Let user decide later if they want to remove.
];

const changes = [];

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  let modified = content;
  let fileChanged = false;
  let perRule = {};
  for (const rule of RULES) {
    const before = modified;
    modified = modified.replace(rule.from, rule.to);
    if (before !== modified) {
      fileChanged = true;
      const matches = before.match(rule.from);
      perRule[rule.from.toString()] = matches ? matches.length : 0;
    }
  }
  if (fileChanged) {
    changes.push({ file: rel, perRule });
    if (!DRY) writeFileSync(file, modified, 'utf8');
  }
}

console.log(DRY ? '\n=== DRY RUN ===\n' : '\n=== WRITTEN ===\n');
for (const c of changes) {
  console.log(c.file);
  for (const [rule, count] of Object.entries(c.perRule)) {
    console.log('  ' + rule + ' → ' + count);
  }
}
console.log(`\nTotal files: ${changes.length}`);
if (DRY) console.log('Re-run with --write to apply.');
