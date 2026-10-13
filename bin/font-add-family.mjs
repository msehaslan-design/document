#!/usr/bin/env node
/**
 * Add whole font families to the vendor catalog (this fork's additions).
 *
 * bin/font-license-sweep.mjs was a one-off that replaced proprietary faces and
 * appended regular + bold only. This script appends a family with all four
 * faces (regular, italic, bold, bold italic) and is meant to be re-run: a
 * family that is already in `__fonts_infos` is left alone.
 *
 * What it writes, for each new family (see docs/fonts.md, "Adding a family
 * needs four things, not one"):
 *   1. one catalog file per face, `public/fonts/<next number>`, XOR-encoded;
 *   2. the file names appended to `__fonts_files`;
 *   3. one `__fonts_infos` row pointing at those positions;
 *   4. one `g_fonts_selection_bin` record per face (bin/lib/selection-bin.mjs).
 * The fourth thing, the picker's thumbnail tiles, is bin/font-thumbnails.mjs:
 * run it afterwards.
 *
 * The family name inside every file has to equal the row's name -- the engine
 * re-resolves the name it reads off the loaded face, so anything else shapes
 * with one face and rasterises with another. The script refuses to write if a
 * file says otherwise.
 *
 * Source faces live in vendor-fonts/ (gitignored, like the sweep's), with the
 * download location next to each family below.
 *
 *   node bin/font-add-family.mjs --check   # report, touch nothing
 *   node bin/font-add-family.mjs           # apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNames, xorPrefix } from './lib/sfnt.mjs';
import { decode, encode, buildRecord } from './lib/selection-bin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = path.join(ROOT, 'public/fonts');
const SOURCE_DIR = path.join(ROOT, 'vendor-fonts');
const ALL_FONTS = path.join(ROOT, 'public/sdkjs/common/AllFonts.js');
const CHECK_ONLY = process.argv.includes('--check');

/**
 * Families this fork adds. Faces are file names in vendor-fonts/; `null`
 * leaves that face out (the engine synthesises it).
 *
 * Inter 4.1 (SIL OFL 1.1): the static TrueType faces from
 * the Inter project's 4.1 release zip, Inter-4.1.zip
 * (extras/ttf/, zip sha256 9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e).
 * TrueType outlines matter: x2t embeds no glyphs for a CFF face in a PDF.
 * It is the fork's default document font (bin/blank-docs/).
 */
const FAMILIES = [
  {
    family: 'Inter',
    faces: { reg: 'Inter-Regular.ttf', ital: 'Inter-Italic.ttf', bold: 'Inter-Bold.ttf', bi: 'Inter-BoldItalic.ttf' },
  },
];

/** face -> index of its position in an `__fonts_infos` row */
const FACE_SLOT = { reg: 1, ital: 3, bold: 5, bi: 7 };

const source = fs.readFileSync(ALL_FONTS, 'utf8');
function locate(key) {
  const marker = `window["${key}"] = [`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`${key} not found in AllFonts.js`);
  const bodyStart = start + marker.length;
  return { bodyStart, bodyEnd: source.indexOf('];', bodyStart) };
}
const at = { files: locate('__fonts_files'), infos: locate('__fonts_infos') };
const files = JSON.parse(`[${source.slice(at.files.bodyStart, at.files.bodyEnd)}]`);
const infos = JSON.parse(`[${source.slice(at.infos.bodyStart, at.infos.bodyEnd).replace(/\n/g, '')}]`);
const selectionAt = (() => {
  const marker = 'window["g_fonts_selection_bin"] = "';
  const start = source.indexOf(marker) + marker.length;
  return { start, end: source.indexOf('"', start) };
})();

const toAdd = FAMILIES.filter(({ family }) => !infos.some((row) => row[0] === family));
if (!toAdd.length) {
  console.log(`font-add-family: nothing to add (${FAMILIES.map((f) => f.family).join(', ')} already in the catalog)`);
  process.exit(0);
}

let last = Math.max(...files.map(Number).filter(Number.isFinite));
const nextSlot = () => String(++last).padStart(3, '0');

const plan = [];
for (const { family, faces } of toAdd) {
  const row = [family, -1, -1, -1, -1, -1, -1, -1, -1];
  const written = [];
  for (const [face, sourceName] of Object.entries(faces)) {
    if (!sourceName) continue;
    const from = path.join(SOURCE_DIR, sourceName);
    if (!fs.existsSync(from)) throw new Error(`missing source face: ${from}`);
    const bytes = fs.readFileSync(from);
    const inside = readNames(bytes)[1];
    if (inside !== family) {
      throw new Error(
        `${sourceName} calls itself "${inside}", not "${family}": the engine would shape with another face`,
      );
    }
    if (bytes.readUInt32BE(0) === 0x4f54544f) {
      throw new Error(`${sourceName} has CFF outlines: x2t embeds nothing for those in a PDF`);
    }
    const slot = nextSlot();
    const position = files.push(slot) - 1;
    row[FACE_SLOT[face]] = position;
    row[FACE_SLOT[face] + 1] = 0;
    written.push({ slot, sourceName, bytes });
  }
  if (row[FACE_SLOT.reg] < 0) throw new Error(`${family} has no regular face`);
  infos.push(row);
  plan.push({ family, row, written });
}

for (const { family, row, written } of plan) {
  const kb = written.reduce((sum, w) => sum + w.bytes.length, 0) / 1024;
  console.log(`${family}: ${written.length} faces, ${kb.toFixed(0)} KB -> ${written.map((w) => w.slot).join(', ')}`);
  console.log(`  row ${JSON.stringify(row)}`);
}
if (CHECK_ONLY) process.exit(0);

const selection = decode(source.slice(selectionAt.start, selectionAt.end));
for (const { written } of plan) {
  for (const { slot, sourceName, bytes } of written) {
    fs.writeFileSync(path.join(CATALOG_DIR, slot), xorPrefix(Buffer.from(bytes)));
    selection.records.push(buildRecord(bytes, { path: `/usr/share/fonts/fonts/${sourceName}` }));
  }
}

const rendered = {
  files: `\n${files.map((f) => `"${f}"`).join(',\n')}\n`,
  infos: `\n${infos.map((r) => JSON.stringify(r)).join(',\n')}\n`,
};
let out = source.slice(0, selectionAt.start) + encode(selection) + source.slice(selectionAt.end);
for (const key of ['infos', 'files']) {
  const where = (() => {
    const marker = `window["${key === 'files' ? '__fonts_files' : '__fonts_infos'}"] = [`;
    const start = out.indexOf(marker) + marker.length;
    return { start, end: out.indexOf('];', start) };
  })();
  out = out.slice(0, where.start) + rendered[key] + out.slice(where.end);
}
fs.writeFileSync(ALL_FONTS, out);
console.log(
  `rewrote AllFonts.js: ${plan.length} famil${plan.length === 1 ? 'y' : 'ies'} added; now run node bin/font-thumbnails.mjs`,
);
