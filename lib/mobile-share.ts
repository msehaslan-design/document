import { Div, View } from 'ranui/builder';
import { saveFileToDisk } from 'ranuts/utils';
import { t } from '@ranuts/shared/i18n';
import 'ranui/button';

/**
 * Saving on a phone or tablet (this fork, both Android and iPhone).
 *
 * There is no File System Access there, so a saved document can only be
 * downloaded -- and on an iPhone a download is the weakest way out: in a home
 * screen app it may not land anywhere the user can find. The system share
 * sheet is the native way to keep or send a file ("Dosyalara Kaydet", Mail,
 * WhatsApp, Drive), so a touch device that can share the file gets a small
 * sheet with "Paylaş" next to "İndir".
 *
 * Which files can be shared is the browser's call: Safari shares Office files,
 * Chrome on Android only a short list of types that includes PDF but not
 * docx/xlsx/pptx. `canShare` answers that per file, and where it says no the
 * old download happens without a sheet.
 *
 * The share is started from a tap on the sheet, not from the save itself:
 * export takes seconds, and by then the tap that asked for it no longer
 * counts as a user gesture -- `navigator.share` would be refused.
 */
export interface ShareEnv {
  coarsePointer: boolean;
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}

export function readShareEnv(): ShareEnv {
  if (typeof window === 'undefined') return { coarsePointer: false };
  const nav = window.navigator as Navigator & Partial<Pick<Navigator, 'share' | 'canShare'>>;
  return {
    coarsePointer: typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
    share: typeof nav.share === 'function' ? nav.share.bind(nav) : undefined,
    canShare: typeof nav.canShare === 'function' ? nav.canShare.bind(nav) : undefined,
  };
}

/** Offer the sheet only on touch devices whose browser will actually share this file. */
export function canOfferShare(file: File, env: ShareEnv = readShareEnv()): boolean {
  if (!env.coarsePointer || !env.share || !env.canShare) return false;
  try {
    return env.canShare({ files: [file] });
  } catch {
    return false;
  }
}

let openSheet: HTMLElement | null = null;

/**
 * Show the sheet for `file`. Resolves true once the file has left the browser
 * (shared or downloaded) and false when the user closes the sheet -- the
 * caller only counts the document as saved in the first case.
 */
export function offerShareSheet(file: File, env: ShareEnv = readShareEnv()): Promise<boolean> {
  openSheet?.dispatchEvent(new Event('ofisim-share-replaced'));
  return new Promise((resolve) => {
    let busy = false;
    const finish = (done: boolean): void => {
      sheet.remove();
      if (openSheet === sheet) openSheet = null;
      resolve(done);
    };
    const download = async (): Promise<void> => {
      await saveFileToDisk(file, file.name);
      finish(true);
    };
    const guarded = (action: () => Promise<void>) => async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        await action();
      } catch (error) {
        // Closing the system sheet is not an error; anything else falls back
        // to the download so the file is never stranded in the page.
        if ((error as DOMException)?.name !== 'AbortError') await download().catch(() => undefined);
      } finally {
        busy = false;
      }
    };

    const share = View('r-button')
      .class('ofisim-share-primary')
      .attr('type', 'primary')
      .text(t('mobileShareShare'))
      .on(
        'click',
        guarded(async () => {
          await env.share!({ files: [file], title: file.name });
          finish(true);
        }),
      )
      .build();
    const save = View('r-button')
      .class('ofisim-share-secondary')
      .text(t('mobileShareDownload'))
      .on('click', guarded(download))
      .build();
    const close = View('button')
      .class('ofisim-share-close')
      .attr('type', 'button')
      .attr('aria-label', t('mobileShareClose'))
      .text('×')
      .on('click', () => finish(false))
      .build();

    const sheet = Div()
      .class('ofisim-share-sheet')
      .attr('role', 'dialog')
      .attr('aria-label', t('mobileShareTitle'))
      .children(
        Div()
          .class('ofisim-share-head')
          .children(
            Div()
              .class('ofisim-share-text')
              .children(
                View('strong').text(t('mobileShareTitle')).build(),
                View('span').class('ofisim-share-name').text(file.name).build(),
              )
              .build(),
            close,
          )
          .build(),
        Div().class('ofisim-share-actions').children(share, save).build(),
      )
      .build();
    sheet.addEventListener('ofisim-share-replaced', () => finish(false));
    openSheet = sheet;
    document.body.appendChild(sheet);
    share.focus?.();
  });
}
