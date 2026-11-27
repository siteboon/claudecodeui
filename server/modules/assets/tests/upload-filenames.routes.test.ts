import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import express from 'express';

import { assetsRoutes } from '@/modules/assets/index.js';

// Uploads land in `~/.cloudcli/assets`, resolved from the home directory on
// every request, so the routes run against a throwaway home.
const fixtureHome = await mkdtemp(path.join(os.tmpdir(), 'assets-upload-filenames-'));
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
process.env.HOME = fixtureHome;
process.env.USERPROFILE = fixtureHome;
const assetsDir = path.join(fixtureHome, '.cloudcli', 'assets');

const server = express().use('/api/assets', assetsRoutes).listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/assets`;

// A handler that throws before responding (as a raw non-latin1 header did)
// leaves the request open, so every request gets a deadline and the server
// drops whatever is still connected when the file ends.
function send(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = previousUserProfile;
  }
  await rm(fixtureHome, { recursive: true, force: true });
});

type StoredRecord = { name: string; path: string; size: number; mimeType: string };

/**
 * Uploads one file the way browsers do: `FormData` puts the filename into the
 * part header as raw UTF-8 bytes.
 */
async function uploadLikeBrowser(field: 'files' | 'images', fileName: string, bytes: Buffer, type: string) {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), fileName);
  return send(`${baseUrl}/${field}`, { method: 'POST', body: form });
}

/** Uploads one file whose Content-Disposition parameters are written by hand. */
async function uploadWithDisposition(field: 'files' | 'images', dispositionParams: string, bytes: Buffer) {
  const boundary = 'cloudcli-upload-filenames-boundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; ${dispositionParams}\r\n`
        + 'Content-Type: text/plain\r\n\r\n',
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return send(`${baseUrl}/${field}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

async function readSingleRecord(response: Response, key: 'attachments' | 'images'): Promise<StoredRecord> {
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200, `upload failed: ${JSON.stringify(body)}`);
  const records = body[key] as StoredRecord[];
  assert.equal(records.length, 1);
  return records[0];
}

/** Reads the UTF-8 `filename*` parameter of a Content-Disposition header. */
function readExtendedFilename(contentDisposition: string | null): string | null {
  const match = /filename\*=UTF-8''([^;]+)/.exec(contentDisposition ?? '');
  return match ? decodeURIComponent(match[1]) : null;
}

test('a non-Latin attachment keeps its name in the response, on disk, and in the download', async () => {
  const originalName = 'Счет-фактура № 1 от 31.07.2026.docx';
  const bytes = Buffer.from('fake docx body');

  const record = await readSingleRecord(
    await uploadLikeBrowser('files', originalName, bytes, 'application/octet-stream'),
    'attachments',
  );
  const storedName = path.basename(record.path);

  assert.equal(record.name, originalName);
  assert.match(storedName, /^\d+-\d+-Счет-фактура___1_от_31\.07\.2026\.docx$/);
  assert.equal(path.dirname(record.path), assetsDir.replace(/\\/g, '/'));
  assert.deepEqual(await readFile(path.join(assetsDir, storedName)), bytes);

  const download = await send(`${baseUrl}/files/${encodeURIComponent(storedName)}`);
  const contentDisposition = download.headers.get('content-disposition');
  assert.equal(download.status, 200);
  assert.match(contentDisposition ?? '', /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.equal(readExtendedFilename(contentDisposition), storedName);
  assert.equal(
    download.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
});

test('a non-Latin image keeps its name and stays viewable', async () => {
  const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');

  const record = await readSingleRecord(
    await uploadLikeBrowser('images', 'Снимок экрана 2026-07-31.png', pngBytes, 'image/png'),
    'images',
  );
  const storedName = path.basename(record.path);

  assert.equal(record.name, 'Снимок экрана 2026-07-31.png');
  assert.match(storedName, /^\d+-\d+-Снимок_экрана_2026-07-31\.png$/);

  const image = await send(`${baseUrl}/images/${encodeURIComponent(storedName)}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), pngBytes);
});

test('names that arrive decoded or as genuine latin1 are not decoded twice', async () => {
  // RFC 5987 form some HTTP clients (e.g. urllib3 1.x) send; busboy decodes it.
  const decoded = await readSingleRecord(
    await uploadWithDisposition('files', "filename*=UTF-8''%D0%A1%D1%87%D0%B5%D1%82.txt", Buffer.from('a')),
    'attachments',
  );
  assert.equal(decoded.name, 'Счет.txt');
  assert.match(path.basename(decoded.path), /^\d+-\d+-Счет\.txt$/);

  const latin1 = await readSingleRecord(
    await uploadWithDisposition('files', "filename*=ISO-8859-1''caf%E9.txt", Buffer.from('b')),
    'attachments',
  );
  assert.equal(latin1.name, 'café.txt');
  assert.match(path.basename(latin1.path), /^\d+-\d+-café\.txt$/);
});

test('a download keeps the type the assets service resolved', async () => {
  const record = await readSingleRecord(
    await uploadLikeBrowser('files', 'Заметки.txt', Buffer.from('e'), 'text/plain'),
    'attachments',
  );
  const storedName = path.basename(record.path);

  const download = await send(`${baseUrl}/files/${encodeURIComponent(storedName)}`);
  assert.equal(download.status, 200);
  // res.attachment() alone would label it `text/plain; charset=utf-8`.
  assert.equal(download.headers.get('content-type'), 'text/plain');
  assert.equal(readExtendedFilename(download.headers.get('content-disposition')), storedName);
  await download.arrayBuffer();
});

test('long names are stored within the filesystem name limit and stay downloadable', async () => {
  for (const originalName of [`${'ж'.repeat(120)}.docx`, `${'x'.repeat(240)}.txt`]) {
    const record = await readSingleRecord(
      await uploadLikeBrowser('files', originalName, Buffer.from('c'), 'application/octet-stream'),
      'attachments',
    );
    const storedName = path.basename(record.path);

    assert.equal(record.name, originalName);
    assert.ok(Buffer.byteLength(storedName) <= 225, `${Buffer.byteLength(storedName)} bytes`);
    assert.equal(path.extname(storedName), path.extname(originalName));

    const download = await send(`${baseUrl}/files/${encodeURIComponent(storedName)}`);
    assert.equal(download.status, 200);
    await download.arrayBuffer();
  }
});

test('names with dot runs are stored in a form the download route accepts', async () => {
  const record = await readSingleRecord(
    await uploadLikeBrowser('files', 'report..final.pdf', Buffer.from('d'), 'application/pdf'),
    'attachments',
  );
  const storedName = path.basename(record.path);

  assert.equal(record.name, 'report..final.pdf');
  assert.match(storedName, /^\d+-\d+-report\.final\.pdf$/);

  const download = await send(`${baseUrl}/files/${encodeURIComponent(storedName)}`);
  assert.equal(download.status, 200);
  await download.arrayBuffer();
});

// Exercise the real multipart routes and filesystem for each script, including
// display names whose safe stored form differs (normalization, spaces, joiners).
const MULTILINGUAL_FILENAMES = [
  ['accented Latin', 'réunion été', 'réunion_été'],
  ['Vietnamese', 'biên bản họp', 'biên_bản_họp'],
  ['Greek', 'σημειώσεις', 'σημειώσεις'],
  ['Ukrainian Cyrillic', 'нотатки зустрічі', 'нотатки_зустрічі'],
  ['Arabic', 'ملاحظات الاجتماع', 'ملاحظات_الاجتماع'],
  ['Hebrew', 'סיכום פגישה', 'סיכום_פגישה'],
  ['Persian with a joiner', 'گزارش\u200cسالانه', 'گزارش_سالانه'],
  ['Hindi Devanagari', 'बैठक विवरण', 'बैठक_विवरण'],
  ['Bengali', 'সভার নোট', 'সভার_নোট'],
  ['Tamil', 'கூட்டக் குறிப்புகள்', 'கூட்டக்_குறிப்புகள்'],
  ['Thai', 'บันทึกการประชุม', 'บันทึกการประชุม'],
  ['Georgian', 'შეხვედრის ჩანაწერი', 'შეხვედრის_ჩანაწერი'],
  ['Japanese', '打ち合わせメモ', '打ち合わせメモ'],
  ['Korean', '회의 메모', '회의_메모'],
  ['Chinese', '会议记录', '会议记录'],
  ['Turkish', 'İstanbul görüşmesi', 'İstanbul_görüşmesi'],
  ['mixed Latin and Greek', 'Éλ', 'Éλ'],
  ['mixed scripts', 'résumé_日本語_العربية', 'résumé_日本語_العربية'],
  ['decomposed Latin accents', 're\u0301sume\u0301', 'résumé'],
  ['supplementary-plane emoji', 'release 🚀', 'release__'],
] as const;

// A synthetic valid 1x1 RGB PNG keeps these transport tests independent of
// private images and of any image-generation provider.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgSPkPAAHLAWRRDtICAAAAAElFTkSuQmCC',
  'base64',
);

for (const [label, originalStem, storedStem] of MULTILINGUAL_FILENAMES) {
  test(`${label} browser filenames round-trip through file and image uploads`, async () => {
    for (const field of ['files', 'images'] as const) {
      const extension = field === 'images' ? 'png' : 'bin';
      const mimeType = field === 'images' ? 'image/png' : 'application/octet-stream';
      const bytes = field === 'images' ? PNG_BYTES : Buffer.from([0, 1, 127, 128, 255]);
      const originalName = `${originalStem}.${extension}`;
      const record = await readSingleRecord(
        await uploadLikeBrowser(field, originalName, bytes, mimeType),
        field === 'images' ? 'images' : 'attachments',
      );
      const storedName = path.basename(record.path);

      assert.equal(record.name, originalName, `${field}: original filename`);
      assert.equal(record.size, bytes.length);
      assert.equal(record.mimeType, mimeType);
      assert.match(storedName, /^\d+-\d+-/);
      assert.ok(storedName.endsWith(`-${storedStem}.${extension}`), `${field}: ${storedName}`);
      assert.equal(path.dirname(record.path), assetsDir.replace(/\\/g, '/'));
      assert.deepEqual(await readFile(path.join(assetsDir, storedName)), bytes);

      const download = await send(`${baseUrl}/${field}/${encodeURIComponent(storedName)}`);
      assert.equal(download.status, 200);
      assert.equal(download.headers.get('content-type'), mimeType);
      assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
      if (field === 'files') {
        const disposition = download.headers.get('content-disposition');
        const downloadName = readExtendedFilename(disposition)
          ?? /filename="([^"]+)"/.exec(disposition ?? '')?.[1];
        assert.equal(downloadName, storedName);
      }
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    }
  });

  test(`${label} RFC 5987 filenames are not decoded twice`, async () => {
    const originalName = `${originalStem}.bin`;
    const bytes = Buffer.from([255, 128, 127, 1, 0]);
    const record = await readSingleRecord(
      await uploadWithDisposition('files', `filename*=UTF-8''${encodeURIComponent(originalName)}`, bytes),
      'attachments',
    );

    assert.equal(record.name, originalName);
    assert.ok(path.basename(record.path).endsWith(`-${storedStem}.bin`));
    assert.deepEqual(await readFile(record.path), bytes);
  });
}
