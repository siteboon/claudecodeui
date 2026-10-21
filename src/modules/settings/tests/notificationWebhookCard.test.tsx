import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import NotificationWebhookCard from '@/modules/settings/tabs/NotificationWebhookCard';
import type { NotificationWebhookDelivery, NotificationWebhookState } from '@/shared/types';

/**
 * Drives the webhook card against an in-memory stand-in for the
 * /api/notifications/webhook routes, so the real api helpers, envelope parsing
 * and error-code mapping are exercised.
 */

type Recorded = { method: string; url: string; body: unknown };

const EMPTY: NotificationWebhookState = {
  configured: false, enabled: false, url: '', allowHttp: false, hasSecret: false, lastDelivery: null,
};
const SECRET = 'whsec_c2VjcmV0LXZhbHVlLWZvci10aGUtY2FyZC10ZXN0cw==';

let state: NotificationWebhookState;
let calls: Recorded[];
let testStatus: number;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function fakeServer(url: string, init: RequestInit = {}): Response {
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url, body });
  const ok = (data: unknown) => json(200, { success: true, data });

  if (url === '/api/notifications/webhook' && method === 'GET') return ok({ webhook: state });
  if (url === '/api/notifications/webhook' && method === 'PUT') {
    if (body.url.startsWith('http://') && !body.allowHttp) {
      return json(400, { success: false, error: { code: 'WEBHOOK_URL_INSECURE', message: 'server text' } });
    }
    state = { ...state, configured: true, url: body.url, allowHttp: body.allowHttp, enabled: body.enabled };
    return ok({ webhook: state });
  }
  if (url === '/api/notifications/webhook' && method === 'DELETE') {
    state = EMPTY;
    return ok({ removed: true });
  }
  if (url === '/api/notifications/webhook/secret' && method === 'POST') {
    state = { ...state, hasSecret: true };
    return ok({ secret: SECRET, webhook: state });
  }
  if (url === '/api/notifications/webhook/test' && method === 'POST') {
    const delivery: NotificationWebhookDelivery = {
      eventId: 'evt_1',
      type: 'webhook.test',
      ok: testStatus < 300,
      status: testStatus,
      error: testStatus < 300 ? null : 'httpStatus',
      attempts: 1,
      at: '2026-10-21T10:00:00.000Z',
    };
    state = { ...state, lastDelivery: delivery };
    return ok({ delivery, webhook: state });
  }
  return json(404, { success: false, error: { code: 'NOT_FOUND', message: 'no route' } });
}

beforeEach(() => {
  state = EMPTY;
  calls = [];
  testStatus = 200;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => fakeServer(url, init)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const urlInput = () => screen.getByLabelText('Destination URL') as HTMLInputElement;
const httpCheckbox = () => screen.getByLabelText(/Allow plain HTTP/) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('NotificationWebhookCard', () => {
  it('starts empty: nothing to save, no secret or test controls, and the privacy note is shown', async () => {
    render(<NotificationWebhookCard />);

    await waitFor(() => expect(urlInput().value).toBe(''));
    expect(httpCheckbox().checked).toBe(false);
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText('Signing secret')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send test event' })).toBeNull();
    expect(screen.getByText(/Prompts, messages and output are never sent/)).toBeTruthy();
  });

  it('shows the server validation error, then saves once plain HTTP is allowed', async () => {
    render(<NotificationWebhookCard />);
    await waitFor(() => expect(urlInput()).toBeTruthy());

    fireEvent.change(urlInput(), { target: { value: '  http://192.168.1.20:5678/webhook  ' } });
    fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Plain http:// URLs need "Allow plain HTTP".');
    expect(state.configured).toBe(false);

    fireEvent.click(httpCheckbox());
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(saveButton());

    await screen.findByText('Saved');
    expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({
      url: 'http://192.168.1.20:5678/webhook',
      allowHttp: true,
      enabled: true,
    });
    expect(screen.getByText('No deliveries yet.')).toBeTruthy();
    expect(screen.getByText(/Not set/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('shows a generated secret once; a reload only knows that one is set', async () => {
    state = { ...EMPTY, configured: true, enabled: true, url: 'https://hooks.example.com/x' };
    const { unmount } = render(<NotificationWebhookCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    const revealed = await screen.findByTestId('notification-webhook-secret');
    expect(revealed.textContent).toContain(SECRET);
    expect(revealed.textContent).toContain('It will not be shown again.');
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: "I've saved it" }));
    expect(screen.queryByTestId('notification-webhook-secret')).toBeNull();

    unmount();
    render(<NotificationWebhookCard />);
    await screen.findByRole('button', { name: 'Rotate' });
    expect(screen.getByText(/· Set/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('sends a test event and shows its delivery status, success and failure', async () => {
    state = { ...EMPTY, configured: true, enabled: true, url: 'https://hooks.example.com/x' };
    render(<NotificationWebhookCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Send test event' }));
    await waitFor(() => expect(screen.getByTestId('notification-webhook-status').textContent)
      .toMatch(/^Last delivery succeeded \(webhook\.test, .+\): HTTP 200$/));

    testStatus = 503;
    fireEvent.click(screen.getByRole('button', { name: 'Send test event' }));
    await waitFor(() => expect(screen.getByTestId('notification-webhook-status').textContent)
      .toMatch(/^Last delivery failed \(webhook\.test, .+, attempts: 1\): The receiver answered HTTP 503\.$/));
  });

  it('keeps the test button off while the form has unsaved changes, and removes the webhook', async () => {
    state = { ...EMPTY, configured: true, enabled: true, url: 'https://hooks.example.com/x' };
    render(<NotificationWebhookCard />);
    const testButton = await screen.findByRole('button', { name: 'Send test event' }) as HTMLButtonElement;
    expect(testButton.disabled).toBe(false);
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(urlInput(), { target: { value: 'https://hooks.example.com/y' } });
    expect(testButton.disabled).toBe(true);
    expect(saveButton().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send test event' })).toBeNull());
    expect(urlInput().value).toBe('');
    expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/notifications/webhook')).toBe(true);
  });
});
