import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { OpenAICompatibleImageProvider } from '@/modules/image-generation/image-generation.provider.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgSPkPAAHLAWRRDtICAAAAAElFTkSuQmCC', 'base64');
const INPUT = { requestId: 'image-1', prompt: '  Keep\nthis 日本語 prompt exactly.  ', quality: 'low', size: '1024x1024' };
const KEY = 'synthetic-private-provider-key';

async function withProvider(
  handler: http.RequestListener,
  run: (endpoint: string) => Promise<void>,
) {
  const server = http.createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run('http://127.0.0.1:' + (server.address() as AddressInfo).port + '/images/generations'); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('compatible HTTP provider preserves prompt/parameters, requests one PNG and uses server-side bearer auth', async () => {
  let captured: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> } | undefined;
  await withProvider(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    captured = { headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
  }, async (endpoint) => {
    const provider = new OpenAICompatibleImageProvider({ endpoint, apiKey: KEY, model: 'configured-model' });
    assert.deepEqual(await provider.generate(INPUT), PNG);
    assert.equal(captured!.headers.authorization, 'Bearer ' + KEY);
    assert.deepEqual(captured!.body, { model: 'configured-model', prompt: INPUT.prompt, n: 1, output_format: 'png', size: INPUT.size, quality: INPUT.quality });
    assert.equal('response_format' in captured!.body, false);
    assert.doesNotMatch(provider.identity, new RegExp(KEY));
  });
});

test('API-key authentication is configurable and credentials do not affect saved request identity', async () => {
  let receivedKey: string | string[] | undefined;
  await withProvider((request, response) => {
    receivedKey = request.headers['api-key'];
    assert.equal(request.headers.authorization, undefined);
    response.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
  }, async (endpoint) => {
    const first = new OpenAICompatibleImageProvider({ endpoint, apiKey: KEY, model: 'model', authMode: 'api-key' });
    const rotated = new OpenAICompatibleImageProvider({ endpoint, apiKey: 'rotated-key', model: 'model', authMode: 'api-key' });
    assert.equal(first.identity, rotated.identity);
    await first.generate(INPUT);
    assert.equal(receivedKey, KEY);
  });
});

for (const status of [400, 401, 403, 429, 500, 503]) {
  test('HTTP ' + status + ' is redacted and is not automatically retried', async () => {
    let calls = 0;
    await withProvider((_request, response) => {
      calls++;
      response.statusCode = status;
      response.end(JSON.stringify({ error: { message: 'do not expose ' + KEY } }));
    }, async (endpoint) => {
      const provider = new OpenAICompatibleImageProvider({ endpoint, apiKey: KEY, model: 'model' });
      await assert.rejects(provider.generate(INPUT), (error: unknown) => {
        assert.doesNotMatch(String(error), new RegExp(KEY));
        assert.equal((error as { outcome: string }).outcome, status < 500 ? 'rejected' : 'uncertain');
        return true;
      });
      assert.equal(calls, 1);
    });
  });
}

test('timeout leaves outcome uncertain and makes only one provider request', async () => {
  let calls = 0;
  await withProvider(() => { calls++; }, async (endpoint) => {
    const provider = new OpenAICompatibleImageProvider({ endpoint, apiKey: KEY, model: 'model', timeoutMs: 100 });
    await assert.rejects(provider.generate(INPUT), { code: 'PROVIDER_UNCERTAIN', outcome: 'uncertain' });
    assert.equal(calls, 1);
  });
});

test('redirects do not forward the configured API key to another endpoint', async () => {
  let calls = 0;
  await withProvider((_request, response) => {
    calls++;
    response.writeHead(307, { Location: '/redirect-target' });
    response.end();
  }, async (endpoint) => {
    const provider = new OpenAICompatibleImageProvider({ endpoint, apiKey: KEY, model: 'model' });
    await assert.rejects(provider.generate(INPUT), { code: 'PROVIDER_UNCERTAIN' });
    assert.equal(calls, 1);
  });
});

for (const payload of ['{', JSON.stringify({ data: [{ url: 'https://example.com/image.png' }] }), JSON.stringify({ data: [{ b64_json: '!!!!' }] }), JSON.stringify({ data: [] })]) {
  test('invalid or URL-only provider result is rejected without fetching an image URL', async () => {
    await withProvider((_request, response) => { response.end(payload); }, async (endpoint) => {
      const provider = new OpenAICompatibleImageProvider({ endpoint, apiKey: KEY, model: 'model' });
      await assert.rejects(provider.generate(INPUT), { code: 'PROVIDER_INVALID_RESPONSE', outcome: 'uncertain' });
    });
  });
}

test('oversized response is bounded before decoding', async () => {
  await withProvider((_request, response) => {
    response.end(JSON.stringify({ data: [{ b64_json: Buffer.alloc(200_000).toString('base64') }] }));
  }, async (endpoint) => {
    const provider = new OpenAICompatibleImageProvider({ endpoint, apiKey: KEY, model: 'model', maxImageBytes: 64 });
    await assert.rejects(provider.generate(INPUT), { code: 'PROVIDER_INVALID_RESPONSE' });
  });
});

test('configuration prevents cleartext remote credentials and URL-embedded secrets', () => {
  for (const endpoint of ['http://example.com/generate', 'https://user:password@example.com/generate', 'https://example.com/generate?api-key=secret']) {
    assert.throws(() => new OpenAICompatibleImageProvider({ endpoint, apiKey: KEY, model: 'model' }), { code: 'INVALID_CONFIG' });
  }
});
