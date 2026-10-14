import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * lib/mobile-share.ts: on a phone or tablet a saved document is offered to the
 * system share sheet next to the download. The sheet only appears where the
 * browser says it can share that very file (Safari: Office files and PDF;
 * Chrome on Android: PDF but not docx/xlsx/pptx), and the save only counts as
 * done once the file has left the page.
 */
const saveFileToDisk = vi.fn(async () => undefined);
vi.mock('ranuts/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ranuts/utils')>()),
  saveFileToDisk: (...args: unknown[]) => saveFileToDisk(...(args as [])),
}));
vi.mock('ranui/button', () => ({}));

const { canOfferShare, offerShareSheet } = await import('../../lib/mobile-share');
type Env = Parameters<typeof canOfferShare>[1] & object;

const docx = new File([new Uint8Array([80, 75, 3, 4])], 'Rapor.docx', {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
const touch = (over: Partial<Env> = {}): Env => ({
  coarsePointer: true,
  share: vi.fn(async () => undefined),
  canShare: vi.fn(() => true),
  ...over,
});
const sheet = () => document.querySelector<HTMLElement>('.ofisim-share-sheet');
const click = (selector: string) => sheet()!.querySelector<HTMLElement>(selector)!.click();
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => saveFileToDisk.mockClear());
afterEach(() => document.querySelectorAll('.ofisim-share-sheet').forEach((el) => el.remove()));

describe('canOfferShare', () => {
  it('needs a touch device whose browser can share this file', () => {
    expect(canOfferShare(docx, touch())).toBe(true);
    expect(canOfferShare(docx, touch({ coarsePointer: false }))).toBe(false);
    expect(canOfferShare(docx, touch({ share: undefined }))).toBe(false);
    expect(canOfferShare(docx, touch({ canShare: undefined }))).toBe(false);
  });

  it('asks the browser about the file itself (Chrome on Android refuses Office files)', () => {
    const canShare = vi.fn((data: ShareData) => !data.files?.[0]?.name.endsWith('.docx'));
    expect(canOfferShare(docx, touch({ canShare }))).toBe(false);
    expect(canShare).toHaveBeenCalledWith({ files: [docx] });
    expect(canOfferShare(new File(['%PDF'], 'Rapor.pdf'), touch({ canShare }))).toBe(true);
  });

  it('treats a throwing canShare as "no"', () => {
    const canShare = () => {
      throw new TypeError('files not supported');
    };
    expect(canOfferShare(docx, touch({ canShare }))).toBe(false);
  });
});

describe('offerShareSheet', () => {
  it('shares the file from a tap on "Paylaş" and counts it as saved', async () => {
    const env = touch();
    const done = offerShareSheet(docx, env);
    expect(sheet()?.getAttribute('role')).toBe('dialog');
    expect(sheet()?.textContent).toContain('Rapor.docx');
    click('.ofisim-share-primary');
    await expect(done).resolves.toBe(true);
    expect(env.share).toHaveBeenCalledWith({ files: [docx], title: 'Rapor.docx' });
    expect(sheet()).toBeNull();
    expect(saveFileToDisk).not.toHaveBeenCalled();
  });

  it('keeps the sheet when the system share sheet is dismissed, and closing it is not a save', async () => {
    const env = touch({ share: vi.fn(async () => Promise.reject(new DOMException('dismissed', 'AbortError'))) });
    const done = offerShareSheet(docx, env);
    click('.ofisim-share-primary');
    await flush();
    expect(sheet()).not.toBeNull();
    expect(saveFileToDisk).not.toHaveBeenCalled();
    click('.ofisim-share-close');
    await expect(done).resolves.toBe(false);
    expect(sheet()).toBeNull();
  });

  it('falls back to the download when sharing fails for any other reason', async () => {
    const env = touch({ share: vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError'))) });
    const done = offerShareSheet(docx, env);
    click('.ofisim-share-primary');
    await expect(done).resolves.toBe(true);
    expect(saveFileToDisk).toHaveBeenCalledWith(docx, 'Rapor.docx');
  });

  it('downloads from "İndir"', async () => {
    const env = touch();
    const done = offerShareSheet(docx, env);
    click('.ofisim-share-secondary');
    await expect(done).resolves.toBe(true);
    expect(saveFileToDisk).toHaveBeenCalledWith(docx, 'Rapor.docx');
    expect(env.share).not.toHaveBeenCalled();
  });

  it('a second save replaces an open sheet instead of stacking them', async () => {
    const first = offerShareSheet(docx, touch());
    const second = offerShareSheet(new File(['x'], 'Tablo.xlsx'), touch());
    await expect(first).resolves.toBe(false);
    expect(document.querySelectorAll('.ofisim-share-sheet')).toHaveLength(1);
    expect(sheet()?.textContent).toContain('Tablo.xlsx');
    click('.ofisim-share-close');
    await expect(second).resolves.toBe(false);
  });
});
