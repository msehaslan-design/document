import { devices } from '@playwright/test';
import { expect, test } from './lib/l0';

/**
 * Phones and tablets, Android and iPhone (this fork).
 *
 * 1. Saving: there is no File System Access on a phone, and on an iPhone a
 *    download is a poor way out, so a touch device whose browser can share the
 *    file gets a sheet with "Paylaş" next to "İndir" (lib/mobile-share.ts,
 *    reached from lib/onlyoffice/save-stream.ts). Desktop Linux Chromium has
 *    no Web Share at all; the phone's is stood in for with one that accepts
 *    every file, as Safari does.
 * 2. Receiving: the installed Android app is a share target
 *    (public/manifest.json). "Share -> Ofisim" is a multipart POST navigation
 *    to /share-target that public/sw.js answers on its own -- the file goes
 *    into the IndexedDB handoff and the editor opens it with ?open=local.
 */
// Pixel 5 carries `defaultBrowserType: 'chromium'`; see mobile-slide.spec.ts
// for why the guard below keys on the project name.
test.use({ ...devices['Pixel 5'] });

const editorReady = (page: import('@playwright/test').Page) =>
  expect.poll(() => page.evaluate(() => Boolean(window.__ooFrames.readyEditor())), { timeout: 150_000 }).toBe(true);

test.describe('phones and tablets (real editor)', () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(({ projectName }) => projectName !== 'chromium', 'device emulation needs chromium');

  test('a save offers "Paylaş" and hands the document to the system share sheet', async ({ page }) => {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      // Neither Android nor iOS has File System Access; without this, desktop
      // Chromium would open its save picker first (lib/save-target.ts).
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
      const shared: { name: string; zip: boolean }[] = [];
      (window as unknown as { __shared: typeof shared }).__shared = shared;
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (data: ShareData) => Boolean(data?.files?.length),
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: ShareData) => {
          for (const file of data.files ?? []) {
            const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
            shared.push({ name: file.name, zip: head[0] === 0x50 && head[1] === 0x4b });
          }
        },
      });
    });
    await page.goto('/editor?new=docx&locale=tr');
    await editorReady(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    // What File -> Download does: an export nobody asked for through the
    // embed API, which is the user's own save.
    await page.evaluate(() => {
      const win = window.__ooFrames.readyEditor() as unknown as {
        Asc: {
          editor: { asc_DownloadAs: (options: unknown) => void };
          asc_CDownloadOptions: new (type: number) => unknown;
          c_oAscFileType?: { DOCX?: number };
        };
      };
      win.Asc.editor.asc_DownloadAs(new win.Asc.asc_CDownloadOptions(win.Asc.c_oAscFileType?.DOCX ?? 65));
    });
    const sheet = page.locator('.ofisim-share-sheet');
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    await expect(sheet).toContainText('Adsız.docx');
    await sheet.locator('.ofisim-share-primary').tap();
    await expect(sheet).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared)).toEqual([
      { name: 'Adsız.docx', zip: true },
    ]);
  });

  test('a document shared to the installed app opens in the editor', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!reg.active) throw new Error('service worker never activated');
    });
    await page.reload();
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    // The POST Android sends for "Share -> Ofisim": multipart, the file under
    // the name the manifest's share_target declares.
    await page.evaluate(async () => {
      const bytes = await (await fetch('/templates/calisma-kagidi.docx')).arrayBuffer();
      const form = document.createElement('form');
      form.method = 'post';
      form.action = '/share-target';
      form.enctype = 'multipart/form-data';
      const input = document.createElement('input');
      input.type = 'file';
      input.name = 'file';
      const files = new DataTransfer();
      files.items.add(
        new File([bytes], 'WhatsApp rapor.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
      input.files = files.files;
      const submit = document.createElement('button');
      submit.id = 'share-submit';
      submit.type = 'submit';
      submit.textContent = 'share';
      form.append(input, submit);
      document.body.append(form);
    });
    await page.locator('#share-submit').click();
    await page.waitForURL(/\/editor/, { timeout: 60_000 });
    await editorReady(page);
    const doc = await page.evaluate(() => {
      const api = (
        window.__ooFrames.readyEditor() as unknown as {
          Asc: { editor: { documentTitle?: string; WordControl: { m_oLogicDocument: { GetText(): string } } } };
        }
      ).Asc.editor;
      return { title: String(api.documentTitle ?? ''), text: String(api.WordControl.m_oLogicDocument.GetText()) };
    });
    expect(doc.title).toBe('WhatsApp rapor.docx');
    expect(doc.text).toContain('ÇALIŞMA KÂĞIDI');
    expect(new URL(page.url()).searchParams.has('open')).toBe(false);
  });
});
