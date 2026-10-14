# Phones and tablets: share sheet on save, Android share target (fork)

Goal: the app should be usable as an office app on Android and iPhone, not
only on a desktop browser. Two gaps were left after the editor itself proved
usable on touch (pinch zoom and one-finger pan work in the desktop UI; the
vendor's mobile editor bundle is not shipped, so `type: 'mobile'` is not an
option and the compact layout of `lib/onlyoffice/viewport.ts` stays the path):

1. **Getting a saved file out.** Phones have no File System Access, so a save
   is a download. On Android that lands in Downloads, which is fine. On an
   iPhone a download from a home-screen web app is the weakest way out, and
   what people actually want is "Save to Files", WhatsApp or Mail -- the system
   share sheet.
2. **Getting a received file in.** Documents arrive in WhatsApp or Gmail. The
   only way in was "Dosya aç" on the homepage and a file picker.

## Share sheet (lib/mobile-share.ts)

- Offered only when `(pointer: coarse)` matches **and** `navigator.canShare({ files: [file] })`
  says yes for that very file. Which types can be shared is the browser's call:
  Safari shares Office files and PDF; Chrome on Android has a fixed allowlist
  (PDF, CSV, text, images, audio, video) without docx/xlsx/pptx. Where
  `canShare` says no, the old download happens and nothing changes.
- The share starts from a tap on our sheet, not from the save: the export takes
  seconds, and by then the tap that asked for it is no longer a user activation,
  so `navigator.share` would be refused.
- Only a user save reaches it: autosave snapshots go through `requestSaveDocument`
  and resolve its in-flight request before `routeSavedFile` gets that far.
- The File System Access writer (`lib/save-target.ts`) still goes first, so a
  touch laptop with a save picker keeps writing back to its file.
- Closing the sheet is not a save (the unsaved-changes flag stays); dismissing
  the system sheet (`AbortError`) keeps ours open; any other share failure falls
  back to the download.

## Android share target (public/manifest.json + public/sw.js)

- `share_target` POSTs multipart to `/share-target` with the file under
  `file`. `accept` lists MIME types (what Android's intent filter uses) and the
  extensions.
- The service worker answers it alone: the file goes into the IndexedDB handoff
  that the homepage's "Dosya aç" already uses (`document-handoff` / `files` /
  `pending`, same record shape as `public/open-local.js`), then 303 to
  `/editor?open=local`. Nothing reaches a server.
- Some apps share without an extension; the editor picks the document type
  from the name, so the MIME type supplies one.
- iOS has no share target for web apps. On iPhone the way in stays "Dosya aç"
  (the picker reaches Files, iCloud and downloads from WhatsApp).
- An app installed before this change only gets the share target when Chrome
  updates its WebAPK from the new manifest (it checks on launch, at most daily);
  reinstalling is the quick way.

## Tests and reverse verification

- `test/unit/mobile-share.test.ts`: when the sheet is offered, and its share /
  dismiss / fallback / download / replace behaviour. Returning `true` instead
  of asking `canShare` turns two cases red.
- `test/unit/sw-share-target.test.ts`: runs the real `public/sw.js` with a raw
  multipart POST and reads the result back with the real `lib/pending-open.ts`.
  Disabling the route turns three cases red.
- `test/e2e/mobile-share.spec.ts` (Pixel 5 emulation, real editor): a save on a
  phone shows the sheet and "Paylaş" hands over the docx; a multipart POST to
  `/share-target` through the controlling worker opens the template docx in
  the editor under the shared name. With `canShare` forced to false in the
  built bundle and the route disabled in the built worker, both go red.
