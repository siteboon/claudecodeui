import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import ProviderCliVersion from '@/modules/settings/tabs/agents-settings/sections/content/ProviderCliVersion';
import type { ProviderCliStatus, ProviderCliUpdateResult } from '@/shared/types';

// Issue #1529: Settings -> Agents -> Account shows which CLI version the server
// runs, whether npm has a newer one, and runs the CLI's own updater.

// Each status request takes the next entry (the last one repeats): a status, a
// ready-made response, or 'pending' for a request that never answers.
type StatusAnswer = ProviderCliStatus | Response | 'pending';
const responses: {
  status: StatusAnswer[];
  update: () => Response | Promise<Response>;
} = { status: [], update: () => new Response('{}') };
const calls: string[] = [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

vi.mock('@/shared/api', async (importOriginal) => {
  // The real readApiJson and ApiRequestError, so error envelopes are read as the app reads them.
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: {
      providers: {
        cliStatus: async (provider: string) => {
          calls.push(`status:${provider}`);
          const next = responses.status.length > 1 ? responses.status.shift() : responses.status[0];
          if (next === 'pending') {
            return new Promise<Response>(() => {});
          }
          return next instanceof Response ? next : json({ success: true, data: next });
        },
        updateCli: async (provider: string) => {
          calls.push(`update:${provider}`);
          return responses.update();
        },
      },
    },
  };
});

const claudeStatus = (overrides: Partial<ProviderCliStatus> = {}): ProviderCliStatus => ({
  provider: 'claude',
  installed: true,
  installedVersion: '2.1.200',
  latestVersion: '2.1.300',
  updateAvailable: true,
  updateCommand: 'claude update',
  updateUnavailableReason: null,
  updateInProgress: false,
  lastUpdate: null,
  ...overrides,
});

const updateResult = (overrides: Partial<ProviderCliUpdateResult> = {}): ProviderCliUpdateResult => ({
  provider: 'claude',
  command: 'claude update',
  exitCode: 0,
  output: 'Successfully updated from 2.1.200 to version 2.1.300',
  previousVersion: '2.1.200',
  installedVersion: '2.1.300',
  failure: null,
  ...overrides,
});

const renderRow = (installedVersion: string | null = '2.1.200') => render(
  <ProviderCliVersion agent="claude" installedVersion={installedVersion} textClass="" subtextClass="" />,
);

// What nginx answers after its 60 s read timeout while the updater keeps running.
const gatewayTimeout = () => new Response('<html><head><title>504 Gateway Time-out</title></head></html>', {
  status: 504,
  statusText: 'Gateway Time-out',
  headers: { 'Content-Type': 'text/html' },
});

/** Lets the row's 3 s poll run now instead of waiting for it. */
const runPoll = () => act(async () => {
  await vi.advanceTimersByTimeAsync(3000);
});

describe('ProviderCliVersion', () => {
  beforeEach(() => {
    responses.status = [];
    calls.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the installed version and the newer npm release with an update button', async () => {
    responses.status = [claudeStatus()];
    renderRow();

    // The auth status version shows before the CLI status answers.
    expect(screen.getByText('Installed: v2.1.200')).toBeTruthy();
    expect(await screen.findByText('Update available: v2.1.300')).toBeTruthy();
    const button = screen.getByRole('button', { name: /Update to v2\.1\.300/ });
    expect(button.getAttribute('title')).toBe('Runs claude update on the server');
  });

  it('runs the update and reports the new version with the updater output', async () => {
    responses.status = [claudeStatus(), claudeStatus({ installedVersion: '2.1.300', updateAvailable: false })];
    responses.update = () => json({ success: true, data: updateResult() });
    renderRow();

    fireEvent.click(await screen.findByRole('button', { name: /Update to v2\.1\.300/ }));
    expect(await screen.findByText('Updated to v2.1.300.')).toBeTruthy();
    expect(screen.getByText('Successfully updated from 2.1.200 to version 2.1.300')).toBeTruthy();
    // The row reloads, so it shows the version the updater left behind.
    await waitFor(() => expect(screen.getByText('Installed: v2.1.300')).toBeTruthy());
    expect(screen.getByText('Up to date')).toBeTruthy();
    expect(calls).toEqual(['status:claude', 'update:claude', 'status:claude']);
  });

  it('explains a permission error with the command to run on the server', async () => {
    responses.status = [claudeStatus()];
    responses.update = () => json({
      success: true,
      data: updateResult({
        exitCode: 1,
        installedVersion: '2.1.200',
        failure: 'permission_denied',
        output: 'Error: Insufficient permissions to install update',
      }),
    });
    renderRow();

    fireEvent.click(await screen.findByRole('button', { name: /Update to v2\.1\.300/ }));
    const message = await screen.findByText(/is not allowed to write where this CLI is installed/);
    expect(message.textContent).toContain('Run claude update on the server as the owner of that install');
  });

  it('says the agent is busy when the server refuses the update', async () => {
    responses.status = [claudeStatus()];
    responses.update = () => json({
      success: false,
      error: { code: 'PROVIDER_CLI_BUSY', message: 'Claude Code is busy in at least one session.' },
    }, 409);
    renderRow();

    fireEvent.click(await screen.findByRole('button', { name: /Update to v2\.1\.300/ }));
    expect((await screen.findByRole('alert')).textContent)
      .toBe('This agent is working in a session. Wait for it to finish or stop it, then update.');
  });

  it('offers no update for a CLI that ships with CloudCLI, and hides itself when the CLI is missing', async () => {
    responses.status = [claudeStatus({
      provider: 'codex',
      installedVersion: '0.156.1',
      latestVersion: null,
      updateAvailable: false,
      updateCommand: null,
      updateUnavailableReason: 'bundled',
    })];
    const { unmount } = renderRow('0.156.1');
    expect(await screen.findByText('Ships with CloudCLI and is updated together with it.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    unmount();

    responses.status = [claudeStatus({ installed: false, installedVersion: null, updateAvailable: false })];
    renderRow(null);
    await waitFor(() => expect(screen.queryByTestId('provider-cli-version')).toBeNull());
  });

  it('disables the button and shows what runs while the update is in progress', async () => {
    responses.status = [claudeStatus()];
    let finish: (response: Response) => void = () => {};
    responses.update = () => new Promise<Response>((resolve) => {
      finish = resolve;
    });
    renderRow();

    fireEvent.click(await screen.findByRole('button', { name: /Update to v2\.1\.300/ }));
    const button = await screen.findByRole('button', { name: /Updating/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Running claude update on the server. This can take a few minutes.')).toBeTruthy();

    finish(json({ success: true, data: updateResult() }));
    expect(await screen.findByText('Updated to v2.1.300.')).toBeTruthy();
  });

  it('says the CLI was already up to date, or that the version did not change when the newest is unknown', async () => {
    responses.status = [claudeStatus({ installedVersion: '2.1.300', updateAvailable: false })];
    responses.update = () => json({
      success: true,
      data: updateResult({ previousVersion: '2.1.300', output: 'Claude Code is up to date (2.1.300)' }),
    });
    const { unmount } = renderRow('2.1.300');
    // Without an update hint the button says what it does: run the updater.
    fireEvent.click(await screen.findByRole('button', { name: 'Run updater' }));
    expect(await screen.findByText('Already up to date (v2.1.300).')).toBeTruthy();
    unmount();

    // Cursor has no npm release to compare with.
    responses.status = [claudeStatus({
      provider: 'cursor',
      installedVersion: '2026.07.20-8cc9c0b',
      latestVersion: null,
      updateAvailable: false,
      updateCommand: 'cursor-agent update',
    })];
    responses.update = () => json({
      success: true,
      data: updateResult({
        command: 'cursor-agent update',
        previousVersion: '2026.07.20-8cc9c0b',
        installedVersion: '2026.07.20-8cc9c0b',
        output: 'Already up to date',
      }),
    });
    renderRow('2026.07.20-8cc9c0b');
    fireEvent.click(await screen.findByRole('button', { name: 'Run updater' }));
    expect(await screen.findByText(
      'The updater finished and the version is still v2026.07.20-8cc9c0b. Its output below says why.',
    )).toBeTruthy();
  });

  it('says the hosting platform manages the CLI and offers no update there', async () => {
    responses.status = [claudeStatus({
      latestVersion: null,
      updateAvailable: false,
      updateCommand: null,
      updateUnavailableReason: 'platform',
    })];
    renderRow();
    expect(await screen.findByText('Managed by the hosting platform.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stops saying it is checking when the version cannot be loaded', async () => {
    responses.status = [json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500)];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRow(null);
    expect(await screen.findByText('Could not read the version')).toBeTruthy();
    expect(screen.queryByText('Checking version…')).toBeNull();
  });

  it('picks up an update that is still running when the row mounts, and shows its result', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    // The update was started before this row mounted: on another agent's tab, or before Settings was reopened.
    responses.status = [
      claudeStatus({ updateInProgress: true }),
      claudeStatus({ updateInProgress: true }),
      claudeStatus({ installedVersion: '2.1.300', updateAvailable: false, lastUpdate: updateResult() }),
    ];
    renderRow();

    const button = await screen.findByRole('button', { name: /Updating/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Running claude update on the server. This can take a few minutes.')).toBeTruthy();

    await runPoll();
    expect(screen.getByRole('button', { name: /Updating/ })).toBeTruthy();
    await runPoll();
    expect(await screen.findByText('Updated to v2.1.300.')).toBeTruthy();
    expect(screen.getByText('Installed: v2.1.300')).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();
    // It only watched: the updater was not started a second time.
    expect(calls).toEqual(['status:claude', 'status:claude', 'status:claude']);
  });

  it('follows the update to its end when a proxy gives up on the request', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    responses.status = [
      claudeStatus(),
      claudeStatus({ updateInProgress: true }),
      claudeStatus({
        installedVersion: '2.1.200',
        lastUpdate: updateResult({
          exitCode: 1,
          installedVersion: '2.1.200',
          failure: 'permission_denied',
          output: 'Error: Insufficient permissions to install update',
        }),
      }),
    ];
    responses.update = gatewayTimeout;
    renderRow();

    fireEvent.click(await screen.findByRole('button', { name: /Update to v2\.1\.300/ }));
    await waitFor(() => expect(calls).toEqual(['status:claude', 'update:claude', 'status:claude']));
    expect(screen.getByRole('button', { name: /Updating/ })).toBeTruthy();

    await runPoll();
    const message = await screen.findByText(/is not allowed to write where this CLI is installed/);
    expect(message.textContent).toContain('Run claude update on the server');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the update may have run when its answer is lost and no run is going on', async () => {
    responses.status = [
      claudeStatus(),
      claudeStatus({
        installedVersion: '2.1.300',
        updateAvailable: false,
        // An earlier run's result: not this request's, since no run was seen going on.
        lastUpdate: updateResult({ exitCode: 1, installedVersion: '2.1.200', failure: 'permission_denied' }),
      }),
    ];
    responses.update = gatewayTimeout;
    renderRow();

    fireEvent.click(await screen.findByRole('button', { name: /Update to v2\.1\.300/ }));
    const alert = await screen.findByRole('alert');
    // The proxy's HTTP status, not the JSON parser's complaint about its HTML page.
    expect(alert.textContent).toMatch(
      /^No answer came back from the server \(HTTP 504 Gateway Time-out\)\. The update may have run anyway;/,
    );
    expect(alert.textContent).not.toContain('did not run');
    expect(screen.queryByText(/is not allowed to write where this CLI is installed/)).toBeNull();
    // The row shows what the server reports now.
    expect(screen.getByText('Installed: v2.1.300')).toBeTruthy();
  });

  it('treats an error answer without a server error code as lost, not as refused', async () => {
    responses.status = [claudeStatus()];
    // A proxy's own JSON error page: the server's refusals always carry a code.
    responses.update = () => json({ message: 'upstream connect error' }, 502);
    renderRow();

    fireEvent.click(await screen.findByRole('button', { name: /Update to v2\.1\.300/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^No answer came back from the server \(.+\)\. The update may have run anyway;/);
    expect(calls).toEqual(['status:claude', 'update:claude', 'status:claude']);
  });

  it('gives the button back when a run it follows can no longer be checked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    responses.status = [
      claudeStatus({ updateInProgress: true }),
      json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500),
    ];
    renderRow();

    expect(await screen.findByRole('button', { name: /Updating/ })).toBeTruthy();
    await runPoll();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^No answer came back from the server \(boom\)\./);
    const button = screen.getByRole('button', { name: /Update to v2\.1\.300/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('stops asking about a running update once the row is gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    responses.status = [claudeStatus({ updateInProgress: true })];
    const { unmount } = renderRow();

    expect(await screen.findByRole('button', { name: /Updating/ })).toBeTruthy();
    unmount();
    await runPoll();
    await runPoll();
    expect(calls).toEqual(['status:claude']);
  });

  it('keeps the update result on screen when the run left the CLI unable to start', async () => {
    responses.status = [
      claudeStatus(),
      claudeStatus({ installed: false, installedVersion: null, latestVersion: null, updateAvailable: false }),
    ];
    responses.update = () => json({
      success: true,
      data: updateResult({
        exitCode: 1,
        installedVersion: null,
        failure: 'failed',
        output: "Error: ENOENT: no such file or directory, rename '/usr/lib/node_modules/.claude-code-x1'",
      }),
    });
    renderRow();

    fireEvent.click(await screen.findByRole('button', { name: /Update to v2\.1\.300/ }));
    // The reload says the CLI is gone; the row stays to show what the run did.
    expect(await screen.findByText('Could not read the version')).toBeTruthy();
    expect(screen.getByText('The update failed (exit code 1). Its output is below.')).toBeTruthy();
    expect(screen.getByText(/ENOENT: no such file or directory/)).toBeTruthy();
    // The server refuses to update a CLI it cannot start.
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('AccountContent CLI version row', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('shows the version from the auth status while the CLI status loads', async () => {
    responses.status = ['pending'];
    render(
      <AccountContent
        agent="claude"
        authStatus={{
          authenticated: true,
          email: 'someone@example.com',
          method: 'credentials_file',
          error: null,
          loading: false,
          installedVersion: '2.1.295',
        }}
        onLogin={() => {}}
      />,
    );

    const row = await screen.findByTestId('provider-cli-version');
    expect(row.textContent).toContain('Installed: v2.1.295');
    expect(calls).toEqual(['status:claude']);
  });
});
