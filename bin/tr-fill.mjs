#!/usr/bin/env node
/**
 * Turkish completion: fill the gaps in the ONLYOFFICE editors' tr.json files.
 *
 * The vendor's Turkish translation is incomplete against en.json (in 9.3 about
 * 18% of the keys are missing in Word, 35% in Excel, 30% in PowerPoint and 78%
 * in PDF). Two consequences:
 *   1. Large parts of the toolbars, menus and tooltips stay in English.
 *   2. Some strings exist only in the locale file, so a missing key leaves the
 *      property `undefined` (see bin/locale-fill.mjs and guard 11,
 *      lib/onlyoffice/guards/hint-fallback.ts).
 *
 * Rule: every key that en.json has and tr.json lacks gets the Turkish text from
 * bin/tr-sozluk.json, looked up by its English text; without a dictionary entry
 * it gets the English value, so no gap is left. A tr.json value the vendor left
 * identical to English is replaced when the dictionary has a translation.
 * Existing Turkish translations are never changed.
 *
 * The dictionary is keyed by English text, not by locale key, so it survives
 * vendor upgrades: a renamed key still finds its translation and a new string
 * falls back to English.
 *
 * Idempotent. bin/build.sh runs it before every build, so the repository keeps
 * the vendor files as shipped and only the build output carries the fill.
 *
 *   node bin/tr-fill.mjs           # fill in place
 *   node bin/tr-fill.mjs --check   # exit 1 if any key is missing
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = join(ROOT, 'public/web-apps/apps');
const KINDS = ['main', 'mobile', 'embed', 'forms'];
const CHECK = process.argv.includes('--check');
const DICTIONARY = JSON.parse(readFileSync(join(ROOT, 'bin/tr-sozluk.json'), 'utf8'));

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Fills `tr` from `en` in place and adds to the counters in `n`. */
function fill(en, tr, n) {
  for (const [key, value] of Object.entries(en)) {
    if (isObject(value)) {
      if (tr[key] === undefined) tr[key] = {};
      if (isObject(tr[key])) fill(value, tr[key], n);
      continue;
    }
    if (typeof value !== 'string') continue;
    const current = tr[key];
    const turkish = DICTIONARY[value];
    if (current === undefined) {
      tr[key] = turkish ?? value;
      n.filled++;
      if (turkish === undefined) n.english++;
    } else if (current === value && turkish !== undefined && turkish !== value) {
      tr[key] = turkish;
      n.fixed++;
    }
  }
  return n;
}

/** Keeps the file's own indentation (a one-line file stays compact). */
const indentOf = (text) => text.match(/\n([ \t]+)"/)?.[1];

let missingTotal = 0;
for (const app of readdirSync(APPS).sort()) {
  for (const kind of KINDS) {
    const dir = join(APPS, app, kind, 'locale');
    const enPath = join(dir, 'en.json');
    const trPath = join(dir, 'tr.json');
    if (!existsSync(enPath) || !existsSync(trPath)) continue;

    const en = JSON.parse(readFileSync(enPath, 'utf8'));
    const raw = readFileSync(trPath, 'utf8');
    const tr = JSON.parse(raw);
    const n = fill(en, tr, { filled: 0, english: 0, fixed: 0 });
    missingTotal += n.filled;

    if (CHECK) {
      if (n.filled) console.error(`[tr-fill] ${app}/${kind}: ${n.filled} missing keys`);
      continue;
    }
    if (!n.filled && !n.fixed) continue;
    writeFileSync(trPath, JSON.stringify(tr, null, indentOf(raw)) + (raw.endsWith('\n') ? '\n' : ''));
    console.log(`[tr-fill] ${app}/${kind}: filled ${n.filled} (${n.english} left in English), fixed ${n.fixed}`);
  }
}

if (CHECK && missingTotal) {
  console.error(`[tr-fill] ${missingTotal} missing keys in total; run node bin/tr-fill.mjs`);
  process.exit(1);
}
