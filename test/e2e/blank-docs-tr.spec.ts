import { expect, test } from './lib/l0';
import type { Page } from '@playwright/test';

/**
 * New documents open from this fork's Turkish blank templates
 * (bin/blank-docs.mjs), not the vendor's Chinese ones.
 *
 * The vendor embeds a blank document in each editor bundle and opens it for
 * `?new=`. Those were the Chinese Office defaults: a Word document in 等线
 * 10.5 pt (which this catalog serves from the 9.9 MB Noto Sans SC), justified,
 * with Chinese margins; a presentation in zh-CN -- the status bar said
 * "中文 - 中华人民共和国" -- with Chinese layout names; a workbook whose sheet is
 * "Sheet1". The build swaps in Turkish templates with Inter as the theme font.
 *
 * What a user sees is checked through the engine's own model, not through
 * pixels: the font the toolbar reports, the language a new run is tagged with,
 * the section's margins, the sheet name, the layout names.
 */
async function openBlank(page: Page, ext: 'docx' | 'xlsx' | 'pptx') {
  await page.goto(`/editor?new=${ext}&locale=tr`);
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__ooFrames.readyEditor())), { timeout: 90_000 })
    .toBe(true);
}

/** The toolbar's font box; it fills in after the first selection change. */
const fontBox = (page: Page) =>
  expect.poll(
    () =>
      page.evaluate(() => {
        const doc = window.__ooFrames.readyEditor()?.document;
        const input = doc?.querySelector('#slot-field-fontname input, .font-name input') as HTMLInputElement | null;
        return input?.value ?? '';
      }),
    { timeout: 30_000 },
  );

test.describe('Turkish blank documents', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a new Word document is Inter 11 pt, Turkish, A4 with 2.5 cm margins', async ({ page }) => {
    await openBlank(page, 'docx');
    await fontBox(page).toBe('Inter');
    const model = await page.evaluate(() => {
      const api = (window.__ooFrames.readyEditor() as any).Asc.editor;
      const defaults = api.WordControl.m_oLogicDocument.Styles.Default;
      const section = api.asc_GetSectionProps();
      return {
        size: defaults.TextPr.FontSize,
        lang: defaults.TextPr.Lang.Val,
        margins: [
          section.get_LeftMargin(),
          section.get_TopMargin(),
          section.get_RightMargin(),
          section.get_BottomMargin(),
        ],
        page: [section.get_W(), section.get_H()],
      };
    });
    expect(model.size).toBe(11);
    expect(model.lang).toBe(1055); // tr-TR
    for (const margin of model.margins) expect(margin).toBeCloseTo(25, 0);
    expect(model.page[0]).toBeCloseTo(210, 0);
    expect(model.page[1]).toBeCloseTo(297, 0);
  });

  test('a new workbook names its sheet Sayfa1 and uses Inter', async ({ page }) => {
    await openBlank(page, 'xlsx');
    await fontBox(page).toBe('Inter');
    const sheet = await page.evaluate(() =>
      (window.__ooFrames.readyEditor() as any).Asc.editor.asc_getWorksheetName(0),
    );
    expect(sheet).toBe('Sayfa1');
  });

  test('a new presentation is Turkish, with Inter theme fonts and Turkish layout names', async ({ page }) => {
    await openBlank(page, 'pptx');
    const model = await page.evaluate(() => {
      const logic = (window.__ooFrames.readyEditor() as any).Asc.editor.WordControl.m_oLogicDocument;
      const master = logic.slideMasters[0];
      const fonts = master.Theme.themeElements.fontScheme;
      const names: string[] = master.sldLayoutLst.map((layout: any) => layout.cSld.name);
      return { major: fonts.majorFont.latin, minor: fonts.minorFont.latin, names };
    });
    expect(model.major).toBe('Inter');
    expect(model.minor).toBe('Inter');
    expect(model.names).toContain('Başlık Slaytı');
    expect(model.names.join(' ')).not.toMatch(/[　-鿿]/);
    // The status bar's language button reads the language of the text at the
    // cursor: it said "中文 - 中华人民共和国" before.
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__ooFrames.readyEditor()?.document.querySelector('#btn-cnt-lang .caption')?.textContent ?? '',
        ),
      )
      .toContain('Türkçe');
  });
});
