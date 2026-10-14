import { expect, test } from './lib/l0';
import type { Page } from '@playwright/test';

/**
 * The homepage's templates open in the real editor under their Turkish names.
 *
 * A card links to `/editor?file=/templates/<file>&name=<name>&locale=tr`: the
 * file is fetched from the site, `?name=` names the document (index.ts,
 * lib/url-file-name.ts) and the roster's formulas are computed by the editor
 * itself -- the template ships without cached values.
 */
async function openFromHome(page: Page, card: string) {
  await page.goto('/');
  await page.locator('.tcard', { hasText: card }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__ooFrames.readyEditor())), { timeout: 90_000 })
    .toBe(true);
}

const editor = (page: Page) =>
  page.evaluate(() => {
    const api = (window.__ooFrames.readyEditor() as any).Asc.editor;
    return { title: String(api.documentTitle ?? '') };
  });

test.describe('templates from the homepage', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the duty roster opens as "Nöbet çizelgesi.xlsx" and computes its days', async ({ page }) => {
    await openFromHome(page, 'Nöbet çizelgesi');
    expect((await editor(page)).title).toBe('Nöbet çizelgesi.xlsx');
    const cells = await page.evaluate(() => {
      const api = (window.__ooFrames.readyEditor() as any).Asc.editor;
      const sheet = api.wbModel.getWorksheetByName('Çizelge');
      const people = api.wbModel.getWorksheetByName('Personel');
      return {
        month: sheet.getCell3(2, 2).getValue(), // C3
        firstDay: sheet.getCell3(6, 1).getValue(), // B7
        lastRow: sheet.getCell3(36, 0).getValue(), // A37: November has 30 days
        firstPersonDuties: people.getCell3(4, 1).getValue(), // B5
      };
    });
    expect(cells.month).toBe('Kasım 2026');
    expect(cells.firstDay).toBe('Pazar');
    expect(cells.lastRow).toBe('');
    expect(String(cells.firstPersonDuties)).toBe('1');
  });

  test('the eye examination report opens as "Göz muayene raporu.docx"', async ({ page }) => {
    await openFromHome(page, 'Göz muayene raporu');
    expect((await editor(page)).title).toBe('Göz muayene raporu.docx');
    const body = await page.evaluate(() =>
      String((window.__ooFrames.readyEditor() as any).Asc.editor.WordControl.m_oLogicDocument.GetText()),
    );
    expect(body).toContain('GÖZ MUAYENE RAPORU');
    expect(body).toContain('Sağ göz (OD)');
  });
});
