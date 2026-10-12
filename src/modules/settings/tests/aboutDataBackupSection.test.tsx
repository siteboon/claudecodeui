import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';

// Issue #1519: a self-hosted install never said where its database lives and
// had no way to back it up. Settings > About now shows the resolved paths and
// downloads a snapshot through the authenticated API (a plain link would not
// carry the bearer token).

const DATABASE_PATH = '/srv/cloudcli/data/auth.db';
const ASSETS_PATH = '/home/me/.cloudcli/assets';
const BACKUP_FILE_NAME = 'cloudcli-backup-2026-10-12T18-30-05Z.db';
const BACKUP_BYTES = new Uint8Array([83, 81, 76, 105, 116, 101]);
const TOKEN = 'header.payload.signature';

type BackupReply = 'ok' | 'error';

/** AboutTab reads the Platform flag at module scope, so each test loads a fresh copy with it stubbed. */
const loadAboutTab = async (isPlatform: boolean) => {
  vi.stubEnv('VITE_IS_PLATFORM', isPlatform ? 'true' : 'false');
  vi.resetModules();
  return (await import('@/modules/settings/tabs/AboutTab')).default;
};

const stubServer = (backupReply: BackupReply = 'ok') => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/system/storage') {
      return new Response(JSON.stringify({ databasePath: DATABASE_PATH, assetsPath: ASSETS_PATH }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/api/system/backup') {
      return backupReply === 'ok'
        ? new Response(BACKUP_BYTES, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.sqlite3',
            'Content-Disposition': `attachment; filename="${BACKUP_FILE_NAME}"`,
          },
        })
        : new Response(JSON.stringify({ success: false, error: { message: 'Internal server error' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
    }
    // Version check (/health, GitHub releases) is irrelevant here.
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const requestHeaders = (fetchMock: ReturnType<typeof stubServer>, url: string) => {
  const call = fetchMock.mock.calls.find(([calledUrl]) => calledUrl === url) as
    | [string, RequestInit | undefined]
    | undefined;
  return (call?.[1]?.headers ?? {}) as Record<string, string>;
};

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clickedAnchors: { href: string; download: string }[];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('auth-token', TOKEN);
  createObjectURL = vi.fn(() => 'blob:cloudcli-backup');
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  clickedAnchors = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clickedAnchors.push({ href: this.getAttribute('href') ?? '', download: this.download });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Settings > About data & backup section', () => {
  it('shows the resolved database and uploads paths', async () => {
    const fetchMock = stubServer();
    const AboutTab = await loadAboutTab(false);
    render(<AboutTab />);

    expect(await screen.findByText(DATABASE_PATH)).toBeTruthy();
    expect(screen.getByText(ASSETS_PATH)).toBeTruthy();
    expect(screen.getByText('Data & backup')).toBeTruthy();
    expect(requestHeaders(fetchMock, '/api/system/storage').Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('downloads the backup with the bearer token and saves it under the server-chosen name', async () => {
    const fetchMock = stubServer();
    const AboutTab = await loadAboutTab(false);
    render(<AboutTab />);
    await screen.findByText(DATABASE_PATH);

    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }));

    await waitFor(() => expect(clickedAnchors).toHaveLength(1));
    expect(requestHeaders(fetchMock, '/api/system/backup').Authorization).toBe(`Bearer ${TOKEN}`);
    expect(clickedAnchors[0]).toEqual({ href: 'blob:cloudcli-backup', download: BACKUP_FILE_NAME });
    const savedBlob = createObjectURL.mock.calls[0][0] as Blob;
    expect(new Uint8Array(await savedBlob.arrayBuffer())).toEqual(BACKUP_BYTES);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:cloudcli-backup'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a failed backup instead of saving the error response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubServer('error');
    const AboutTab = await loadAboutTab(false);
    render(<AboutTab />);
    await screen.findByText(DATABASE_PATH);

    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The backup could not be created. Please try again.',
    );
    expect(clickedAnchors).toHaveLength(0);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Download backup' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('stays hidden on Platform installs, whose storage the platform manages', async () => {
    const fetchMock = stubServer();
    const AboutTab = await loadAboutTab(true);
    render(<AboutTab />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('about-storage-section')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/system/'))).toBe(false);
  });
});
