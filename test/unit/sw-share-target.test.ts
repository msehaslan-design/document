import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { takePendingFile } from '../../lib/pending-open';

/**
 * Android share target: public/manifest.json declares `share_target`, and
 * "Share -> Ofisim" POSTs the file to /share-target, which public/sw.js
 * answers without the network. The record it writes must be the one
 * lib/pending-open.ts reads for ?open=local -- this drives the real worker
 * script into the real reader.
 */
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const ORIGIN = 'https://ofisim.example';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function worker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL,
    Promise,
    Date,
    Headers,
    Response,
    indexedDB,
    self: {
      location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
      addEventListener: (name: string, callback: (event: unknown) => void) => {
        listeners[name] = callback;
      },
    },
  });
  return listeners;
}

type Part = { name: string; fileName: string; type: string; bytes: number[] };

const docx = (fileName: string, type = DOCX): Part => ({
  name: manifest.share_target.params.files[0].name,
  fileName,
  type,
  bytes: [0x50, 0x4b, 3, 4, 9],
});

/**
 * The raw multipart body Android sends. Built by hand rather than with
 * FormData: under jsdom, FormData is jsdom's while Request is Node's, and
 * Node's Request does not recognise it as a form.
 */
function multipart(parts: Part[]) {
  const boundary = '----ofisim-share-test';
  const chunks: Uint8Array[] = [];
  const text = (value: string) => chunks.push(new TextEncoder().encode(value));
  for (const part of parts) {
    text(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.fileName}"\r\n`);
    text(`Content-Type: ${part.type}\r\n\r\n`);
    chunks.push(new Uint8Array(part.bytes));
    text('\r\n');
  }
  text(`--${boundary}--\r\n`);
  const body = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

function share(parts: Part[], path = manifest.share_target.action): Promise<Response> | undefined {
  const { body, type } = multipart(parts);
  let response: Promise<Response> | undefined;
  worker().fetch({
    request: new Request(`${ORIGIN}${path}`, { method: 'POST', body, headers: { 'content-type': type } }),
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
    waitUntil: () => {},
  });
  return response;
}

beforeEach(async () => {
  await takePendingFile(); // one-shot: clears anything a previous case left
});

describe('manifest share_target', () => {
  it('posts files to the route the worker answers', () => {
    const target = manifest.share_target;
    expect(target).toMatchObject({ action: '/share-target', method: 'POST', enctype: 'multipart/form-data' });
    expect(target.params.files).toHaveLength(1);
    const { name, accept } = target.params.files[0];
    expect(name).toBe('file');
    for (const type of [
      DOCX,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/pdf',
    ]) {
      expect(accept).toContain(type);
    }
  });
});

describe('POST /share-target in the service worker', () => {
  it('hands the shared file to ?open=local without touching the network', async () => {
    const response = await share([docx('Rapor (1).docx')]);
    expect(response?.status).toBe(303);
    expect(response?.headers.get('location')).toBe(`${ORIGIN}/editor?open=local`);
    const file = await takePendingFile();
    expect(file?.name).toBe('Rapor (1).docx');
    expect(file?.type).toBe(DOCX);
    expect([...new Uint8Array(await file!.arrayBuffer())]).toEqual([0x50, 0x4b, 3, 4, 9]);
  });

  it('names an extension-less share from its MIME type, since the editor reads the type from the name', async () => {
    await share([docx('IMG-2026-WA0001')]);
    expect((await takePendingFile())?.name).toBe('IMG-2026-WA0001.docx');
  });

  it('sends a share with no file back to the homepage', async () => {
    const response = await share([]);
    expect(response?.headers.get('location')).toBe(`${ORIGIN}/`);
    expect(await takePendingFile()).toBeNull();
  });

  it('leaves every other POST alone', () => {
    expect(share([docx('a.docx')], '/upload')).toBeUndefined();
  });
});
