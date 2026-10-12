import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import { PluginsProvider } from '@/modules/plugins/context/PluginsContext';
import PluginSettingsTab from '@/modules/plugins/PluginSettingsTab';
import type { Plugin } from '@/shared/types';

type StubbedReply = { status: number; body: unknown };

// Every plugin route hands its failures to the global error middleware, which
// answers with the structured AppError envelope.
const envelope = (code: string, message: string) => ({
  success: false,
  error: { code, message, details: { gitCommand: 'git clone', exitCode: 128, gitOutput: 'fatal: …' } },
});

const AUTH_MESSAGE = 'Could not install the plugin: git could not authenticate to the repository\'s host, '
  + 'so the repository is private or does not exist.';
const UPDATE_MESSAGE = 'Could not update the plugin: the repository was not found. Check the URL.';

const installedPlugin: Plugin = {
  name: 'private-demo',
  displayName: 'Private Demo',
  version: '1.0.0',
  description: '',
  author: '',
  icon: '',
  type: 'module',
  slot: 'tab',
  entry: 'index.js',
  server: null,
  permissions: [],
  enabled: true,
  serverRunning: false,
  dirName: 'private-demo',
  repoUrl: 'https://git.example.test/acme/private-demo',
};

// `api.plugins.*` calls the global fetch, so stubbing it drives the real
// PluginsProvider and settings tab without module mocks.
function stubPluginsApi(replies: Record<string, StubbedReply>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const reply = replies[url] ?? { status: 404, body: { error: 'Not found' } };
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function renderPluginSettings() {
  render(
    <PluginsProvider>
      <PluginSettingsTab />
    </PluginsProvider>,
  );
}

describe('Settings > Plugins shows why a git install or update failed', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the message of a failed install and keeps the settings view', async () => {
    stubPluginsApi({
      '/api/plugins': { status: 200, body: { plugins: [] } },
      '/api/plugins/install': { status: 422, body: envelope('PLUGIN_GIT_AUTH_REQUIRED', AUTH_MESSAGE) },
    });
    renderPluginSettings();

    const input = await screen.findByLabelText('Plugin git repository URL');
    fireEvent.change(input, { target: { value: 'https://github.com/acme/private-plugin' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText(AUTH_MESSAGE)).toBeTruthy();
    expect(screen.getByLabelText('Plugin git repository URL')).toBeTruthy();
  });

  it('shows the message of a failed update on the plugin card', async () => {
    stubPluginsApi({
      '/api/plugins': { status: 200, body: { plugins: [installedPlugin] } },
      '/api/plugins/private-demo/update': {
        status: 422,
        body: envelope('PLUGIN_GIT_REPO_NOT_FOUND', UPDATE_MESSAGE),
      },
    });
    renderPluginSettings();

    fireEvent.click(await screen.findByRole('button', { name: 'Pull latest from git' }));

    expect(await screen.findByText(UPDATE_MESSAGE)).toBeTruthy();
    expect(screen.getByText('Private Demo')).toBeTruthy();
  });
});
