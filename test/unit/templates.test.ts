import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readZipEntry } from 'ranuts/utils';

/**
 * The homepage's "Şablonlar" section (content/ofisim-home.html, copied to the
 * root index.html) opens files from public/templates/ in the editor:
 * `/editor?file=/templates/<file>&name=<Turkish name>&locale=tr`. This pins the
 * link -> file contract and what each template promises (Inter, Turkish);
 * test/e2e/templates.spec.ts opens them in the real editor.
 */
const ROOT = resolve(__dirname, '../..');
const home = readFileSync(resolve(ROOT, 'content/ofisim-home.html'), 'utf8');
const cards = [...home.matchAll(/<a\s+class="tcard[^"]*"\s+href="([^"]+)"/g)].map(
  (m) => new URL(m[1], 'https://x.test'),
);

const text = async (file: string, part: string) => {
  const data = await readZipEntry(new Uint8Array(readFileSync(resolve(ROOT, 'public/templates', file))), part);
  if (!data) throw new Error(`${file}: no ${part}`);
  return new TextDecoder().decode(data);
};

describe('homepage templates', () => {
  it('lists five templates', () => {
    expect(cards).toHaveLength(5);
  });

  it('links each card to a file that ships, under a name with the same extension, in Turkish', () => {
    for (const url of cards) {
      expect(url.pathname).toBe('/editor');
      const file = url.searchParams.get('file') ?? '';
      expect(file).toMatch(/^\/templates\/[a-z0-9-]+\.(docx|xlsx|pptx)$/);
      expect(existsSync(resolve(ROOT, 'public', file.slice(1))), file).toBe(true);
      const name = url.searchParams.get('name') ?? '';
      expect(name.split('.').pop(), name).toBe(file.split('.').pop());
      expect(url.searchParams.get('locale')).toBe('tr');
    }
  });

  it('keeps the root index.html in step with its source', () => {
    expect(readFileSync(resolve(ROOT, 'index.html'), 'utf8')).toBe(home);
  });
});

describe('template files', () => {
  it('Word templates are set in Inter and tagged Turkish', async () => {
    for (const file of ['goz-muayene-raporu.docx', 'goz-saglik-kurulu-raporu.docx', 'calisma-kagidi.docx']) {
      const styles = await text(file, 'word/styles.xml');
      expect(styles, file).toContain('w:ascii="Inter"');
      expect(styles, file).toContain('w:val="tr-TR"');
      const body = await text(file, 'word/document.xml');
      expect(body, file).toContain('w:w="11906"'); // A4
    }
  });

  it('the duty roster computes its days and counts with formulas, in Inter', async () => {
    const book = await text('nobet-cizelgesi.xlsx', 'xl/workbook.xml');
    expect(book).toContain('name="Çizelge"');
    expect(book).toContain('name="Personel"');
    const roster = await text('nobet-cizelgesi.xlsx', 'xl/worksheets/sheet1.xml');
    expect(roster).toContain('CHOOSE(WEEKDAY(A7,2)');
    const people = await text('nobet-cizelgesi.xlsx', 'xl/worksheets/sheet2.xml');
    expect(people).toContain('COUNTIFS(');
    expect(await text('nobet-cizelgesi.xlsx', 'xl/styles.xml')).toContain('val="Inter"');
  });

  it('the lecture deck uses Inter as its theme fonts', async () => {
    const theme = await text('ders-sunumu.pptx', 'ppt/theme/theme1.xml');
    expect(theme).toMatch(/<a:majorFont><a:latin typeface="Inter"/);
    expect(theme).toMatch(/<a:minorFont><a:latin typeface="Inter"/);
  });
});
