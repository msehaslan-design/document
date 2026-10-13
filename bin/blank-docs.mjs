#!/usr/bin/env node
/**
 * Turkish blank documents: what "New document / spreadsheet / presentation"
 * opens with.
 *
 * The vendor's offline controller (web-apps/apps/<editor>/main/app.js, plus the
 * ie/ build of each) opens a new document from a literal embedded in the
 * bundle -- `e.doc.url ? convertToBin(...) : {binary:"DOCY;v5;..."}` -- so a
 * blank document never has to load x2t. Those literals are the Chinese Office
 * defaults: the Word one is set in 等线 10.5 pt, justified, with Chinese
 * margins; the PowerPoint one is in zh-CN with Chinese layout names
 * (标题幻灯片 ...) and master texts; the Excel one names its sheet "Sheet1".
 * In this fork's catalog 等线 resolves to the 9.9 MB Noto Sans SC, so every new
 * Word document also downloaded a CJK face to type Latin text.
 *
 * bin/blank-docs/tr.{docx,xlsx,pptx} are the same templates made Turkish:
 * Inter as the theme font (bin/font-add-family.mjs puts it in the catalog),
 * tr-TR as the language, A4 with 2.5 cm margins, Word's 11 pt / 8 pt after /
 * 1.08 lines, a "Sayfa1" sheet, Turkish layout names and master texts.
 *
 * bin/blank-docs/literals.json holds each one as x2t converts it on open: the
 * no-base64 stream, "<SIG>;v10;0;" + raw bytes, base64-encoded for transport.
 * It is embedded as bytes, exactly the shape an opened file reaches
 * `loadDocumentData` in. Relabelling it as the vendor's text form
 * ("DOCY;v5;<len>;<base64>") does NOT work: the reader takes the header's
 * version as the stream's version (AscCommon.CurFileVersion) and x2t writes
 * the v10 layout -- measured, the Word template came up in the engine's
 * built-in defaults and the presentation crashed the renderer.
 *
 * The repository keeps the vendor files as shipped -- bin/build.sh runs this
 * before every build, like bin/tr-fill.mjs.
 *
 *   node bin/blank-docs.mjs             # inject (idempotent)
 *   node bin/blank-docs.mjs --check     # exit 1 if a bundle still has the vendor literal
 *   node bin/blank-docs.mjs --generate  # rebuild literals.json from the OOXML sources
 *
 * --generate needs a running build of this site (BLANK_DOCS_BASE, default
 * http://localhost:4173, e.g. `pnpm exec vite preview --port 4173`): it opens
 * an editor and runs each source through the editor's own x2t, the converter
 * that would otherwise run when the file is opened.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = join(ROOT, 'bin/blank-docs');
const LITERALS = join(SOURCES, 'literals.json');
const APPS = join(ROOT, 'public/web-apps/apps');

/** Editor -> template, with the signature its stream carries. */
const EDITORS = {
  documenteditor: { source: 'tr.docx', signature: 'DOCY' },
  spreadsheeteditor: { source: 'tr.xlsx', signature: 'XLSY' },
  presentationeditor: { source: 'tr.pptx', signature: 'PPTY' },
};
const BUNDLES = ['main/app.js', 'main/ie/app.js'];

/** The vendor's literal, or a previous run's replacement. Exactly one per bundle. */
const VENDOR = /"(DOCY|XLSY|PPTY);v\d+;\d+;[A-Za-z0-9+/=]{200,}"/g;
const MARK = '/*ofisim-blank*/';
const OURS = /\/\*ofisim-blank\*\/\(function\(s\)\{[^{}]*\}\)\("[A-Za-z0-9+/=]+"\)/g;
/** ES5 on purpose: the ie/ bundles run it too. */
const embed = (base64) =>
  `${MARK}(function(s){for(var b=atob(s),u=new Uint8Array(b.length),n=0;n<b.length;n++)u[n]=b.charCodeAt(n);return u})("${base64}")`;

if (process.argv.includes('--generate')) {
  await generate();
} else {
  inject(process.argv.includes('--check'));
}

function inject(checkOnly) {
  const literals = JSON.parse(readFileSync(LITERALS, 'utf8'));
  let stale = 0;
  for (const [editor, { signature }] of Object.entries(EDITORS)) {
    const base64 = literals[editor];
    if (
      !Buffer.from(base64 ?? '', 'base64')
        .toString('latin1')
        .startsWith(`${signature};v10;0;`)
    ) {
      throw new Error(`literals.json: no ${signature} stream for ${editor}`);
    }
    const wanted = embed(base64);
    for (const bundle of BUNDLES) {
      const file = join(APPS, editor, bundle);
      const text = readFileSync(file, 'utf8');
      const found = [...text.matchAll(VENDOR), ...text.matchAll(OURS)];
      // Exactly one, and where the offline controller reads it: anything else
      // means the vendor changed and this script needs a second look.
      if (found.length !== 1)
        throw new Error(`${editor}/${bundle}: expected one embedded blank document, found ${found.length}`);
      const [match, sig] = found[0];
      if (sig && sig !== signature) throw new Error(`${editor}/${bundle}: embedded ${sig}, expected ${signature}`);
      if (!text.slice(0, found[0].index).endsWith('{binary:')) {
        throw new Error(`${editor}/${bundle}: the blank document is not a {binary: ...} value any more`);
      }
      if (match === wanted) continue;
      stale++;
      if (checkOnly) {
        console.error(`[blank-docs] ${editor}/${bundle}: not the Turkish blank document`);
        continue;
      }
      writeFileSync(file, text.slice(0, found[0].index) + wanted + text.slice(found[0].index + match.length));
      console.log(`[blank-docs] ${editor}/${bundle}: Turkish blank document`);
    }
  }
  if (checkOnly && stale) {
    console.error('[blank-docs] run node bin/blank-docs.mjs');
    process.exit(1);
  }
}

async function generate() {
  const base = process.env.BLANK_DOCS_BASE || 'http://localhost:4173';
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/editor?new=docx`, { waitUntil: 'load' });
    let frame;
    for (let i = 0; i < 120 && !frame; i++) {
      await page.waitForTimeout(1000);
      for (const f of page.frames()) {
        if (await f.evaluate(() => Boolean(window.AscCommon?.x2t)).catch(() => false)) frame = f;
      }
    }
    if (!frame) throw new Error(`no editor with x2t came up at ${base}`);

    const literals = {};
    for (const [editor, { source, signature }] of Object.entries(EDITORS)) {
      const ext = source.split('.').pop();
      const out = await frame.evaluate(
        async ({ base64, ext }) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes]));
          const result = await window.AscCommon.x2t.convertToBin(url, `blank.${ext}`, ext);
          let binary = '';
          for (const byte of new Uint8Array(result.binary)) binary += String.fromCharCode(byte);
          return btoa(binary);
        },
        { base64: readFileSync(join(SOURCES, source)).toString('base64'), ext },
      );
      const stream = Buffer.from(out, 'base64');
      if (!stream.toString('latin1').startsWith(`${signature};v10;0;`)) {
        throw new Error(`${source}: x2t did not return a ${signature} stream`);
      }
      literals[editor] = out;
      console.log(`[blank-docs] ${source}: ${stream.length} bytes`);
    }
    writeFileSync(LITERALS, JSON.stringify(literals, null, 2) + '\n');
  } finally {
    await browser.close();
  }
}
