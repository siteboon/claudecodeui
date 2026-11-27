import assert from 'node:assert/strict';

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { test, vi } from 'vitest';

import type { Plugin } from '@/shared/types';
import { findToolRendererPlugin, toolPatternMatches } from '@/modules/plugins/tool-renderers/matchToolRenderer';

vi.mock('@/shared/context/ThemeContext', () => ({ useTheme: () => ({ isDarkMode: false }) }));
vi.mock('@/shared/api', () => ({
  api: { plugins: { asset: vi.fn(async () => ({ ok: false, status: 404 })), rpc: vi.fn() } },
}));

const plugin = (over: Partial<Plugin>): Plugin => ({
  name: 'p', displayName: 'P', version: '1', description: '', author: '', icon: '', type: 'module', slot: 'tab',
  entry: 'dist/index.js', server: null, permissions: [], enabled: true, serverRunning: false, dirName: 'p', repoUrl: null,
  ...over,
});

test('patterns match exact names and trailing-star prefixes only', () => {
  assert.equal(toolPatternMatches('mcp__coagent__*', 'mcp__coagent__spawn_agent'), true);
  assert.equal(toolPatternMatches('mcp__coagent__*', 'mcp__other__x'), false);
  assert.equal(toolPatternMatches('Bash', 'Bash'), true);
  assert.equal(toolPatternMatches('Bash', 'BashOutput'), false);
});

test('disabled plugins and plugins without the tool are skipped', () => {
  const plugins = [
    plugin({ name: 'off', enabled: false, toolRenderers: ['mcp__x__*'] }),
    plugin({ name: 'none' }),
    plugin({ name: 'on', toolRenderers: ['mcp__x__*'] }),
  ];
  assert.equal(findToolRendererPlugin(plugins, 'mcp__x__go')?.name, 'on');
  assert.equal(findToolRendererPlugin(plugins, 'Read'), null);
});

test('a plugin that fails to load keeps the host rendering', async () => {
  const { default: PluginToolRenderer } = await import('@/modules/plugins/tool-renderers/PluginToolRenderer');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <MemoryRouter>
      <PluginToolRenderer plugin={plugin({ toolRenderers: ['mcp__x__*'] })} toolName="mcp__x__go" toolInput={{}}
        status="running" fallback={<span>host row</span>} />
    </MemoryRouter>,
  );
  await waitFor(() => screen.getByText('host row'));
  await new Promise((r) => setTimeout(r, 20));
  screen.getByText('host row');
});
