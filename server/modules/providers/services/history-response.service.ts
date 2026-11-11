import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import type { Request, Response } from 'express';

const gzipAsync = promisify(gzip);
const MIN_GZIP_BYTES = 1024;

/** Used only by the providers history GET route after authentication and history loading. */
export async function sendSessionHistoryResponse(req: Request, res: Response, payload: unknown): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Accept-Encoding');

  // This is not global compression: range requests and non-GET transport retain
  // Express's original JSON response, and no stream/media route calls this helper.
  if (req.method !== 'GET' || req.headers.range || req.headers['if-range']) {
    res.json(payload);
    return;
  }

  const encoding = req.acceptsEncodings('gzip', 'identity');
  if (!encoding) {
    res.status(406).end();
    return;
  }
  if (encoding !== 'gzip') {
    res.json(payload);
    return;
  }

  // Match Express res.json serialization, including app-level JSON formatting.
  let json = JSON.stringify(payload, res.app.get('json replacer'), res.app.get('json spaces'));
  if (json === undefined) {
    res.type('json').send();
    return;
  }
  if (res.app.get('json escape')) {
    json = json.replace(/[<>&]/g, character => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[character]!);
  }
  const bytes = Buffer.from(json, 'utf8');
  if (bytes.length < MIN_GZIP_BYTES && req.acceptsEncodings('identity')) {
    // Do not invoke a stateful replacer or toJSON hook a second time.
    res.type('json').send(bytes);
    return;
  }

  const compressed = await gzipAsync(bytes, { level: 6 });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Encoding', 'gzip');
  res.send(compressed);
}
