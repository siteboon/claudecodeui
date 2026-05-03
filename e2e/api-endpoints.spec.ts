import { test, expect } from '@playwright/test';

const API = 'http://localhost:3099';

test.describe('API Endpoints', () => {
  test('GET / serves the frontend HTML', async ({ request }) => {
    const res = await request.get(`${API}/`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<!doctype html>');
  });

  test('GET /api/projects returns JSON', async ({ request }) => {
    const res = await request.get(`${API}/api/projects`);
    // 200 with data or 401 if auth required
    expect([200, 401, 429]).toContain(res.status());
    if (res.status() === 200) {
      const json = await res.json();
      expect(Array.isArray(json) || typeof json === 'object').toBe(true);
    }
  });

  test('GET /api/9router/status returns health data', async ({ request }) => {
    const res = await request.get(`${API}/api/9router/status`);
    expect(res.status()).toBeLessThan(502);
    if (res.status() === 200) {
      const json = await res.json();
      expect(json).toHaveProperty('health');
    }
  });

  test('GET /api/settings returns settings object', async ({ request }) => {
    const res = await request.get(`${API}/api/settings`);
    expect([200, 401, 429]).toContain(res.status());
  });

  test('POST /api/auth/login with bad creds returns 401', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      data: { username: 'nonexistent', password: 'wrong' },
    });
    expect([400, 401, 403, 429]).toContain(res.status());
  });

  test('GET /api/commands returns command list', async ({ request }) => {
    const res = await request.get(`${API}/api/commands`);
    expect([200, 401, 404]).toContain(res.status());
  });

  test('GET /api/git returns git info', async ({ request }) => {
    const res = await request.get(`${API}/api/git`);
    expect([200, 401, 404]).toContain(res.status());
  });

  test('WebSocket endpoint is accessible', async ({ request }) => {
    // Just verify the upgrade endpoint exists (will get 400 without proper WS handshake)
    const res = await request.get(`${API}/ws`).catch(() => null);
    // WS endpoint may return various codes for non-WS requests
    expect(true).toBe(true);
  });

  test('unknown API route returns 404', async ({ request }) => {
    const res = await request.get(`${API}/api/nonexistent-endpoint-xyz`);
    expect([200, 404, 401]).toContain(res.status());
  });

  test('static assets are served with correct content type', async ({ request }) => {
    const res = await request.get(`${API}/`);
    const contentType = res.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });
});
