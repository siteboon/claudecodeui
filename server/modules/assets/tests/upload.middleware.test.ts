import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';
import type { RequestHandler } from 'express';
import multer from 'multer';

import { createAssetUploadMiddleware } from '@/modules/assets/upload.middleware.js';

const REQUEST_ID = '12345678-1234-4234-8234-123456789abc';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const readUploadError = async (response: Response) =>
  await response.json() as { code: string; error: string; requestId: string };

async function withUploadServer(
  run: (baseUrl: string, logs: unknown[], requestStarted: Promise<void>) => Promise<void>,
  upload: RequestHandler = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 2 },
  }).array('files', 2),
  kind: 'files' | 'images' = 'files',
) {
  const logs: unknown[] = [];
  let markStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  const app = express();
  app.post('/upload', (_request, _response, next) => { markStarted(); next(); },
    createAssetUploadMiddleware(upload, { kind, maxBytes: 1024 * 1024, maxFiles: 2 }, {
      info: (entry: unknown) => logs.push(entry), warn: (entry: unknown) => logs.push(entry),
    }), (_request, response) => response.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/upload`, logs, requestStarted);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const multipart = (count = 1, bytes = 4) => {
  const form = new FormData();
  for (let index = 0; index < count; index++) {
    form.append('files', new Blob([new Uint8Array(bytes)]), `synthetic-${index}.txt`);
  }
  return form;
};

test('successful multipart uploads retain a UUID and log one safe terminal event', async () => {
  await withUploadServer(async (url, logs) => {
    const response = await fetch(`${url}?token=synthetic-secret`, {
      method: 'POST', body: multipart(),
      headers: { 'X-Upload-Request-ID': REQUEST_ID, Authorization: 'Bearer synthetic-secret' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Upload-Request-ID'), REQUEST_ID);
    await response.json();
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0], {
      event: 'attachment_upload_finished', requestId: REQUEST_ID, kind: 'files',
      durationMs: (logs[0] as { durationMs: number }).durationMs, status: 200, requestComplete: true,
    });
    assert.doesNotMatch(JSON.stringify(logs), /synthetic|token|Bearer|filename|originalname/);
  });
});

test('replaces arbitrary correlation headers with a server-generated UUID', async () => {
  await withUploadServer(async (url, logs) => {
    const response = await fetch(url, {
      method: 'POST', body: multipart(), headers: { 'X-Upload-Request-ID': 'synthetic-private-value' },
    });
    assert.match(response.headers.get('X-Upload-Request-ID')!, UUID_PATTERN);
    await response.json();
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-private-value/);
  });
});

test('oversized real multipart uploads return 413 with the configured limit', async () => {
  await withUploadServer(async (url, logs) => {
    const response = await fetch(url, { method: 'POST', body: multipart(1, 1024 * 1024 + 1) });
    assert.equal(response.status, 413);
    const body = await readUploadError(response);
    assert.equal(body.code, 'LIMIT_FILE_SIZE');
    assert.equal(body.error, 'Each file must be 1 MB or smaller.');
    assert.equal(body.requestId, response.headers.get('X-Upload-Request-ID'));
    assert.equal(logs.length, 2);
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-/);
  });
});

test('too many multipart files return a readable count limit', async () => {
  await withUploadServer(async (url) => {
    const response = await fetch(url, { method: 'POST', body: multipart(3) });
    assert.equal(response.status, 400);
    const body = await readUploadError(response);
    assert.equal(body.code, 'LIMIT_FILE_COUNT');
    assert.equal(body.error, 'Upload at most 2 files using the attachment picker.');
  });
});

test('an unfinished multipart body returns an interruption error', async () => {
  await withUploadServer(async (url) => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=example' },
      body: '--example\r\nContent-Disposition: form-data; name="files"; filename="example.txt"\r\n\r\npartial',
    });
    assert.equal(response.status, 400);
    assert.equal((await readUploadError(response)).code, 'UPLOAD_INCOMPLETE');
  });
});

for (const code of ['ENOSPC', 'EDQUOT', 'EACCES', 'EROFS', 'EPERM']) {
  test(`storage error ${code} is recoverable without exposing filesystem paths`, async () => {
    await withUploadServer(async (url, logs) => {
      const response = await fetch(url, { method: 'POST' });
      assert.equal(response.status, 503);
      const body = await readUploadError(response);
      assert.equal(body.code, 'UPLOAD_STORAGE_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify({ body, logs }), /private-path/);
    }, (_request, _response, next) => next(Object.assign(new Error('/private-path/document.txt'), { code })));
  });
}

test('unknown failures return 500 without publishing raw error messages', async () => {
  await withUploadServer(async (url, logs) => {
    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 500);
    const body = await readUploadError(response);
    assert.equal(body.code, 'UPLOAD_FAILED');
    assert.doesNotMatch(JSON.stringify({ body, logs }), /private-path/);
  }, (_request, _response, next) => next(new Error('/private-path/document.txt')));
});

test('the legacy images endpoint retains its invalid MIME type feedback', async () => {
  await withUploadServer(async (url) => {
    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 400);
    assert.equal((await readUploadError(response)).code, 'UPLOAD_INVALID_TYPE');
  }, (_request, _response, next) => next(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.')), 'images');
});

test('an aborted client logs one terminal event without a false success status', { timeout: 5000 }, async () => {
  await withUploadServer(async (url, logs, requestStarted) => {
    const request = http.request(url, { method: 'POST', headers: {
      'Content-Type': 'multipart/form-data; boundary=example', 'Content-Length': 100000,
      'X-Upload-Request-ID': REQUEST_ID,
    } });
    request.on('error', () => undefined);
    request.write('--example\r\n');
    await requestStarted;
    request.destroy();
    // Let the server receive the disconnect before inspecting its completion log.
    for (let attempt = 0; attempt < 50 && logs.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const terminal = logs.filter((entry) => (entry as { event: string }).event !== 'attachment_upload_failed');
    assert.equal(terminal.length, 1);
    assert.equal((terminal[0] as { event: string }).event, 'attachment_upload_aborted');
    assert.equal((terminal[0] as { status?: number }).status, undefined);
  });
});
