/**
 * The name for a document opened from `?file=<url>` when the link also carries
 * `?name=`.
 *
 * This fork's templates live at plain ASCII paths (/templates/goz-muayene-raporu.docx)
 * but should open, save and land in the history as "Göz muayene raporu.docx".
 * Only a bare file name is taken -- no directories -- and it always keeps the
 * URL's extension, because the editor picks the document type from the name
 * and a mismatch fails its fileType check. Anything unusable returns
 * `undefined`, which leaves the old behaviour (the URL's own file name).
 */
export function fileNameFromParam(name: unknown, url: string, base = 'https://localhost/'): string | undefined {
  if (typeof name !== 'string') return undefined;
  // Control characters and the ones file systems refuse.
  const bare = [...(name.split(/[\\/]/).pop() ?? '')]
    .filter((ch) => ch.charCodeAt(0) >= 32 && !'<>:"|?*'.includes(ch))
    .join('')
    .trim()
    .slice(0, 120);
  if (!bare || bare.startsWith('.')) return undefined;

  let urlName = '';
  try {
    urlName = new URL(url, base).pathname.split('/').pop() ?? '';
  } catch {
    return undefined;
  }
  const dot = urlName.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const ext = urlName.slice(dot + 1).toLowerCase();

  const own = bare.lastIndexOf('.') > 0 ? bare.slice(bare.lastIndexOf('.') + 1).toLowerCase() : '';
  return own === ext ? bare : `${bare}.${ext}`;
}
