import assert from 'node:assert/strict';
import test from 'node:test';

import type { Request, RequestHandler, Response } from 'express';

import {
  createBrowserUseApiAuthentication,
  createBrowserUseViewerWebSocketAuthentication,
} from '../browser-use.auth.js';

function createResponse() {
  let statusCode = 200;
  let responseBody: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      responseBody = body;
      return response;
    },
  };
  return {
    response: response as unknown as Response,
    getStatusCode: () => statusCode,
    getBody: () => responseBody,
  };
}

test('Browser API authentication delegates non-viewer routes to application auth', () => {
  let delegated = false;
  const applicationAuth: RequestHandler = (_req, _res, next) => {
    delegated = true;
    next();
  };
  const middleware = createBrowserUseApiAuthentication(
    applicationAuth,
    () => false,
    'viewer_cookie',
  );
  let continued = false;

  middleware(
    { path: '/settings', query: {}, headers: {} } as Request,
    createResponse().response,
    () => {
      continued = true;
    },
  );

  assert.equal(delegated, true);
  assert.equal(continued, true);
});

test('Browser API authentication accepts viewer tokens from query or scoped cookie', () => {
  const acceptedTokens: Array<string | null | undefined> = [];
  const middleware = createBrowserUseApiAuthentication(
    () => {
      throw new Error('Application auth must not run for viewer assets.');
    },
    (sessionId, token) => {
      acceptedTokens.push(token);
      return sessionId === 'session/id' && token === 'viewer-token';
    },
    'viewer_cookie',
  );

  for (const request of [
    {
      path: '/sessions/session%2Fid/viewer/vnc.html',
      query: { viewerToken: 'viewer-token' },
      headers: {},
    },
    {
      path: '/sessions/session%2Fid/viewer/app/ui.js',
      query: {},
      headers: { cookie: 'unrelated=1; viewer_cookie=viewer-token' },
    },
  ]) {
    let continued = false;
    middleware(
      request as unknown as Request,
      createResponse().response,
      () => {
        continued = true;
      },
    );
    assert.equal(continued, true);
  }

  assert.deepEqual(acceptedTokens, ['viewer-token', 'viewer-token']);
});

test('Browser API authentication rejects invalid and malformed viewer credentials', () => {
  const middleware = createBrowserUseApiAuthentication(
    () => {
      throw new Error('Application auth must not run for viewer assets.');
    },
    () => false,
    'viewer_cookie',
  );

  for (const path of [
    '/sessions/unknown/viewer/vnc.html',
    '/sessions/%E0%A4%A/viewer/vnc.html',
  ]) {
    const result = createResponse();
    let continued = false;
    middleware(
      { path, query: {}, headers: {} } as Request,
      result.response,
      () => {
        continued = true;
      },
    );
    assert.equal(continued, false);
    assert.equal(result.getStatusCode(), 401);
    assert.deepEqual(result.getBody(), {
      error: 'Browser viewer access requires a valid session token.',
    });
  }
});

test('Browser viewer WebSocket authentication validates only the exact viewer path', () => {
  const authenticate = createBrowserUseViewerWebSocketAuthentication(
    (sessionId, token) => sessionId === 'session/id' && token === 'viewer-token',
  );

  assert.equal(
    authenticate(
      '/api/browser-use/sessions/session%2Fid/viewer/websockify',
      'viewer-token',
    ),
    true,
  );
  assert.equal(
    authenticate('/api/browser-use/sessions/session%2Fid/viewer/vnc.html', 'viewer-token'),
    false,
  );
  assert.equal(
    authenticate('/api/browser-use/sessions/%E0%A4%A/viewer/websockify', 'viewer-token'),
    false,
  );
});
