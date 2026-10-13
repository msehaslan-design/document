import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readZipEntries, readZipEntry } from 'ranuts/utils';

/**
 * The Turkish blank documents (bin/blank-docs.mjs). The build swaps them into
 * the editor bundles; test/e2e/blank-docs-tr.spec.ts checks what a new document
 * then looks like. This pins the two things that can drift without a browser:
 * the sources still say what the feature promises, and the vendor bundles
 * still have exactly one blank document where the injector expects it -- a
 * vendor bump that moves it fails here, not on the first user's new document.
 */
const ROOT = resolve(__dirname, '../..');
const SOURCES = resolve(ROOT, 'bin/blank-docs');
const literals: Record<string, string> = JSON.parse(readFileSync(resolve(SOURCES, 'literals.json'), 'utf8'));

const zip = (name: string) => new Uint8Array(readFileSync(resolve(SOURCES, name)));
const text = async (file: string, part: string) => {
  const data = await readZipEntry(zip(file), part);
  if (!data) throw new Error(`${file}: no ${part}`);
  return new TextDecoder().decode(data);
};
/** Han, kana and CJK punctuation; the theme's per-script font table is allowed to name CJK faces. */
const CJK = /[　-鿿]/;
const withoutScriptFonts = (xml: string) =>
  xml.replace(/<a:font script="[^"]*" typeface="[^"]*"\s*\/?>(<\/a:font>)?/g, '');

describe('Turkish blank document sources', () => {
  it('Word: Inter theme fonts, tr-TR, 11 pt, left aligned, A4 with 2.5 cm margins', async () => {
    const theme = await text('tr.docx', 'word/theme/theme1.xml');
    expect(theme).toContain('<a:majorFont><a:latin typeface="Inter">');
    expect(theme).toContain('<a:minorFont><a:latin typeface="Inter">');
    const styles = await text('tr.docx', 'word/styles.xml');
    expect(styles).toContain('<w:lang w:val="tr-TR"');
    expect(styles).toContain('<w:sz w:val="22" />');
    expect(styles).not.toContain('<w:jc w:val="both" />');
    const body = await text('tr.docx', 'word/document.xml');
    expect(body).toContain('<w:pgSz w:h="16838" w:w="11906" />');
    expect(body).toContain('w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"');
    expect(await text('tr.docx', 'word/settings.xml')).toContain(
      '<w:themeFontLang w:val="tr-TR" w:eastAsia="en-US" />',
    );
  });

  it('Excel: one sheet called Sayfa1, Inter', async () => {
    expect(await text('tr.xlsx', 'xl/workbook.xml')).toContain('<sheet name="Sayfa1"');
    expect(await text('tr.xlsx', 'xl/styles.xml')).toContain('<name val="Inter"/>');
  });

  it('PowerPoint: Turkish layout names, tr-TR runs, Inter theme fonts', async () => {
    expect(await text('tr.pptx', 'ppt/slideLayouts/slideLayout1.xml')).toContain('<p:cSld name="Başlık Slaytı"');
    expect(await text('tr.pptx', 'ppt/presentation.xml')).toContain('<a:defRPr lang="tr-TR">');
    expect(await text('tr.pptx', 'ppt/theme/theme1.xml')).toContain('<a:minorFont><a:latin typeface="Inter">');
  });

  it('leaves nothing Chinese behind outside the themes’ per-script font tables', async () => {
    for (const file of ['tr.docx', 'tr.xlsx', 'tr.pptx']) {
      for (const { name } of readZipEntries(zip(file))) {
        if (!name.endsWith('.xml')) continue;
        expect(withoutScriptFonts(await text(file, name)), `${file}/${name}`).not.toMatch(CJK);
      }
    }
  });
});

describe('embedded blank documents', () => {
  const EDITORS = { documenteditor: 'DOCY', spreadsheeteditor: 'XLSY', presentationeditor: 'PPTY' } as const;

  it('carries an x2t stream per editor, in the form an opened file arrives in', () => {
    for (const [editor, signature] of Object.entries(EDITORS)) {
      const stream = Buffer.from(literals[editor], 'base64');
      expect(stream.subarray(0, 11).toString('latin1'), editor).toBe(`${signature};v10;0;`);
      expect(stream.length, editor).toBeGreaterThan(1000);
    }
  });

  it('finds exactly one blank document per vendor bundle, as the {binary: ...} the offline controller reads', () => {
    // The vendor's literal, or the injected one after a local build (the build
    // rewrites public/ in place, like bin/tr-fill.mjs).
    const literal = /"(DOCY|XLSY|PPTY);v\d+;\d+;[A-Za-z0-9+/=]{200,}"|\/\*ofisim-blank\*\/\(function/g;
    for (const [editor, signature] of Object.entries(EDITORS)) {
      for (const bundle of ['main/app.js', 'main/ie/app.js']) {
        const source = readFileSync(resolve(ROOT, 'public/web-apps/apps', editor, bundle), 'utf8');
        const found = [...source.matchAll(literal)];
        expect(found, `${editor}/${bundle}`).toHaveLength(1);
        if (found[0][1]) expect(found[0][1]).toBe(signature);
        expect(source.slice(found[0].index! - 8, found[0].index)).toBe('{binary:');
      }
    }
  });
});
