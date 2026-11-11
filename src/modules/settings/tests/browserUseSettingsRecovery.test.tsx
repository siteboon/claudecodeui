import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import BrowserUseSettingsTab from '@/modules/settings/tabs/browser-use-settings/BrowserUseSettingsTab';

let enabled: boolean;
let saveFailure: 'partial' | 'generic' | 'malformed' | null;
let recoveryFailure: boolean;
let saveCount: number;
let settingsReads: number;
let delayedStatus: Promise<Response> | undefined;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const statusResponse = () => json({ success: true, data: { enabled, available: enabled, playwrightInstalled: true, chromiumInstalled: true, installInProgress: false, message: '' } });

beforeEach(() => {
  enabled = false;
  saveFailure = null;
  recoveryFailure = false;
  saveCount = 0;
  settingsReads = 0;
  delayedStatus = undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/settings') && init.method === 'PUT') {
      ++saveCount;
      if (saveFailure !== 'generic' && saveFailure !== 'malformed') enabled = JSON.parse(String(init.body)).enabled;
      if (saveFailure === 'malformed') return new Response('not JSON', { status: 502 });
      if (saveFailure) return json({ success: false, error: { code: saveFailure === 'partial' ? 'BROWSER_USE_SETTINGS_APPLY_FAILED' : 'BROWSER_USE_SETTINGS_SAVE_FAILED', message: 'DO_NOT_EXPOSE', details: 'DO_NOT_EXPOSE' } }, 500);
      return json({ success: true, data: { settings: { enabled } } });
    }
    if (url.endsWith('/settings')) {
      ++settingsReads;
      if (recoveryFailure && settingsReads > 1) throw new Error('offline');
      return json({ success: true, data: { settings: { enabled } } });
    }
    if (url.endsWith('/status')) {
      if (delayedStatus) { const response = delayedStatus; delayedStatus = undefined; return response; }
      return statusResponse();
    }
    throw new Error(`Unexpected synthetic URL ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const toggle = () => screen.getByRole('switch', { name: 'Enable Browser' }) as HTMLButtonElement;
const ready = async () => { await waitFor(() => expect(toggle().disabled).toBe(false)); };

it('saves successfully and notifies other browser consumers', async () => {
  const changed = vi.fn();
  window.addEventListener('browserUseSettingsChanged', changed);
  try {
    render(<BrowserUseSettingsTab />);
    await ready();
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));
    await ready();
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  } finally { window.removeEventListener('browserUseSettingsChanged', changed); }
});

it('recovers the persisted enabled state after registration fails and retries without toggling it off', async () => {
  saveFailure = 'partial';
  render(<BrowserUseSettingsTab />);
  await ready();
  fireEvent.click(toggle());
  await ready();
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('alert').textContent).toContain('settings were saved');
  expect(screen.getByRole('alert').textContent).not.toContain('DO_NOT_EXPOSE');
  expect(settingsReads).toBe(2);
  saveFailure = null;
  fireEvent.click(screen.getByRole('button', { name: 'Retry applying settings' }));
  await waitFor(() => expect(saveCount).toBe(2));
  await ready();
  expect(enabled).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['generic', 'malformed'] as const)('keeps the actual disabled state for a %s save failure', async failure => {
  saveFailure = failure;
  render(<BrowserUseSettingsTab />);
  await ready();
  fireEvent.click(toggle());
  await ready();
  expect(toggle().getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('alert').textContent).toContain('Failed to save Browser settings');
  expect(screen.getByRole('alert').textContent).not.toContain('DO_NOT_EXPOSE');
  expect(screen.queryByRole('button', { name: 'Retry applying settings' })).toBeNull();
});

it('retains the original explanation and asks for a refresh if recovery cannot load settings', async () => {
  saveFailure = 'partial';
  recoveryFailure = true;
  render(<BrowserUseSettingsTab />);
  await ready();
  fireEvent.click(toggle());
  await ready();
  expect(screen.getByRole('alert').textContent).toContain('settings were saved');
  expect(screen.getByRole('alert').textContent).toContain('Could not reload');
  expect(screen.queryByRole('button', { name: 'Retry applying settings' })).toBeNull();
});

it('ignores an initial status response arriving after a save', async () => {
  let resolve!: (response: Response) => void;
  delayedStatus = new Promise(done => { resolve = done; });
  const stale = statusResponse();
  render(<BrowserUseSettingsTab />);
  await ready();
  fireEvent.click(toggle());
  await ready();
  expect(screen.getByText('Status: ready')).toBeTruthy();
  await act(async () => resolve(stale));
  expect(screen.getByText('Status: ready')).toBeTruthy();
});

it('ignores a save response after unmount and does not notify other consumers', async () => {
  let resolve!: (response: Response) => void;
  const changed = vi.fn();
  window.addEventListener('browserUseSettingsChanged', changed);
  try {
    const view = render(<BrowserUseSettingsTab />);
    await ready();
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(toggle());
    view.unmount();
    await act(async () => resolve(json({ success: true, data: { settings: { enabled: true } } })));
    expect(changed).not.toHaveBeenCalled();
  } finally { window.removeEventListener('browserUseSettingsChanged', changed); }
});
