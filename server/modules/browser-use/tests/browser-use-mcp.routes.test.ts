import assert from 'node:assert/strict';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

const { default: browserUseMcpRoutes } = await import('@/modules/browser-use/browser-use-mcp.routes.js');

type FakeResponse = {
  statusCode: number | null;
  body: unknown;
  status(code: number): FakeResponse;
  json(payload: unknown): void;
};

function makeFakeResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: null,
    body: null,
    status(code) {
      response.statusCode = code;
      return response;
    },
    json(payload) {
      response.body = payload;
    },
  };
  return response;
}

type FakeRequestOptions = {
  remoteAddress?: string;
  authorization?: string;
  forwardedFor?: string;
};

function makeFakeRequest(options: FakeRequestOptions) {
  return {
    method: 'POST',
    url: '/tools/browser_list_sessions',
    headers: {
      ...(options.authorization ? { authorization: options.authorization } : {}),
      ...(options.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {}),
    },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    body: {},
  } as unknown as Parameters<typeof browserUseMcpRoutes>[0];
}

/** Drives the router as express middleware would, capturing the first response. */
function route(request: Parameters<typeof browserUseMcpRoutes>[0]): Promise<{ statusCode: number | null; body: unknown }> {
  return new Promise((resolve) => {
    const response = makeFakeResponse();
    browserUseMcpRoutes(request, response as never, () => {
      // next() means the middleware chain accepted the request.
      resolve({ statusCode: null, body: null });
    });
    // The loopback/token guards respond synchronously; resolve defensively.
    setImmediate(() => resolve({ statusCode: response.statusCode, body: response.body }));
  });
}

const VALID_TOKEN = browserUseService.getMcpToken();

test('mcp routes accept loopback requests with a valid token', async () => {
  const result = await route(makeFakeRequest({ remoteAddress: '127.0.0.1', authorization: `Bearer ${VALID_TOKEN}` }));
  // Reaching next() (statusCode null) or any tool-level response means the
  // loopback guard passed; only a 403 would indicate rejection.
  assert.notEqual(result.statusCode, 403);
});

test('mcp routes reject remote addresses even with a valid token', async () => {
  const result = await route(makeFakeRequest({ remoteAddress: '203.0.113.7', authorization: `Bearer ${VALID_TOKEN}` }));
  assert.equal(result.statusCode, 403);
  assert.equal((result.body as { error?: string }).error, 'Browser MCP tools only accept local requests.');
});

test('mcp routes reject loopback requests that arrived through a proxy', async () => {
  const result = await route(makeFakeRequest({
    remoteAddress: '127.0.0.1',
    forwardedFor: '203.0.113.7',
    authorization: `Bearer ${VALID_TOKEN}`,
  }));
  assert.equal(result.statusCode, 403);
});

test('mcp routes accept ipv6 loopback', async () => {
  const result = await route(makeFakeRequest({ remoteAddress: '::1', authorization: `Bearer ${VALID_TOKEN}` }));
  assert.notEqual(result.statusCode, 403);
});
