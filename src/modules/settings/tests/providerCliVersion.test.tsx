import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import ProviderCliVersion from '@/modules/settings/tabs/agents-settings/sections/content/ProviderCliVersion';
import type { ProviderCliStatus, ProviderCliUpdateResult } from '@/shared/types';

// Issue #1529: Settings -> Agents -> Account shows which CLI version the server
// runs, whether npm has a newer one, and runs the CLI's own updater.

const responses: {
  status: ProviderCliStatus[];
  update: () => Response;
} = { status: [], update: () => new Response('{}') };
const calls: string[] = [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api')>();
  return {
    ...actual,
    api: {
      providers: {
        cliStatus: async (provider: string) => {
          calls.push(`status:${provider}`);
          const next = responses.status.length > 1 ? responses.status.shift() : responses.status[0];
          return json({ success: true, data: next });
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

describe('ProviderCliVersion', () => {
  beforeEach(() => {
    responses.status = [];
    calls.length = 0;
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
});
