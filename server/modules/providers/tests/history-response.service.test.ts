import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';

import express from 'express';

import { sendSessionHistoryResponse } from '@/modules/providers/services/history-response.service.js';

const app = express();
const payload = { success: true, data: { messages: [{ content: 'α<&>'.repeat(3000) }], total: 1 } };
app.set('json spaces', 2);
app.set('json escape', true);
app.set('json replacer', (key: string, value: unknown) => key === 'total' ? 123 : value);
app.get('/reference', (_req, res) => { res.json(payload); });
app.get('/history', (req, res, next) => {
  if (req.headers.authorization !== 'Bearer test-only') { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (req.query.forbidden) { res.status(403).json({ error: 'Forbidden' }); return; }
  void sendSessionHistoryResponse(req, res, req.query.small ? { ok: true } : payload).catch(next);
});
let smallSerializations = 0;
app.get('/stateful', (req, res, next) => {
  void sendSessionHistoryResponse(req, res, { toJSON() { return { count: ++smallSerializations }; } }).catch(next);
});
app.get('/events', (_req, res) => { res.type('text/event-stream').send('data: test\n\n'); });
app.get('/media', (_req, res) => { res.status(206).set('Content-Range', 'bytes 0-2/10').type('video/mp4').send(Buffer.from('abc')); });
let server: http.Server;
let port: number;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  port = (server.address() as { port: number }).port;
});
after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
/**
 * Requests the loopback fixture server and collects raw wire bytes without automatic
 * decompression. Uses a synthetic bearer value unless testing unauthenticated access;
 * caller headers can override it. Rejects network errors and retains response headers
 * so encoding, length and cache behavior can be compared with ordinary Express JSON.
 */
async function get(url: string, headers: Record<string, string> = {}, authorized = true) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: url, headers: { ...(authorized ? { Authorization: 'Bearer test-only' } : {}), ...headers } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
test('gzip decompresses to exact Express JSON bytes and preserves formatting/escaping/replacer', async (t) => {
  const original = await get('/reference');
  const compressed = await get('/history', { 'Accept-Encoding': 'gzip' });
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.equal(compressed.headers['cache-control'], 'private, no-store');
  assert.match(String(compressed.headers.vary), /Accept-Encoding/);
  assert.deepEqual(gunzipSync(compressed.body), original.body);
  assert.equal(Number(compressed.headers['content-length']), compressed.body.length);
  assert(compressed.body.length < original.body.length);
  t.diagnostic(`Synthetic response: identity=${original.body.length} bytes; gzip=${compressed.body.length} bytes; decompressed bytes match exactly.`);
});
test('identity, absent encoding and gzip q=0 preserve original JSON', async () => {
  const reference = await get('/reference');
  const cases: Array<Record<string, string>> = [{}, { 'Accept-Encoding': 'identity' }, { 'Accept-Encoding': 'gzip;q=0' }, { 'Accept-Encoding': 'gzip;q=0, br' }, { 'Accept-Encoding': 'gzip;q=0.1, identity;q=1' }];
  for (const headers of cases) {
    const response = await get('/history', headers);
    assert.equal(response.headers['content-encoding'], undefined);
    assert.deepEqual(response.body, reference.body);
    assert.equal(response.headers['cache-control'], 'private, no-store');
  }
});
test('small payload stays identity unless identity explicitly forbidden', async () => {
  assert.equal((await get('/history?small=1', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], undefined);
  assert.equal((await get('/history?small=1', { 'Accept-Encoding': 'gzip, identity;q=0' })).headers['content-encoding'], 'gzip');
});
test('refusal of both supported encodings returns 406', async () => {
  assert.equal((await get('/history', { 'Accept-Encoding': 'gzip;q=0, identity;q=0, *;q=0' })).status, 406);
});
test('authentication and forbidden errors are unchanged', async () => {
  const unauthorized = await get('/history', { 'Accept-Encoding': 'gzip' }, false);
  const forbidden = await get('/history?forbidden=1', { 'Accept-Encoding': 'gzip' });
  assert.equal(unauthorized.status, 401); assert.equal(forbidden.status, 403);
  for (const response of [unauthorized, forbidden]) {
    assert.equal(response.headers['content-encoding'], undefined);
    assert.equal(response.headers['cache-control'], undefined);
  }
});
test('range history, SSE and media paths do not gain compression', async () => {
  for (const [url, extra, status] of [['/history', { Range: 'bytes=0-2' }, 200], ['/events', {}, 200], ['/media', { Range: 'bytes=0-2' }, 206]] as const) {
    const response = await get(url, { 'Accept-Encoding': 'gzip', ...extra });
    assert.equal(response.status, status); assert.equal(response.headers['content-encoding'], undefined);
  }
});

test('small gzip-eligible responses serialize only once', async () => {
  smallSerializations = 0;
  const response = await get('/stateful', { 'Accept-Encoding': 'gzip' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], undefined);
  assert.equal(smallSerializations, 1);
  assert.deepEqual(JSON.parse(response.body.toString()), { count: 1 });
});
