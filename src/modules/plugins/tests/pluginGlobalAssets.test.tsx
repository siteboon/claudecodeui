import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

import { PluginsProvider, usePlugins } from '@/modules/plugins/context/PluginsContext';
import PluginGlobalAssets from '@/modules/plugins/PluginGlobalAssets';
import type * as PluginAssetLoading from '@/modules/plugins/utils/pluginAssetLoading';
import type { Plugin } from '@/shared/types';

const pluginModule = vi.hoisted(() => ({
  cleanup: vi.fn(),
  start: vi.fn(),
}));

// jsdom cannot import from a Blob URL, so the module import is the one piece
// replaced; the CSS still travels through the real assets route stub below.
vi.mock('@/modules/plugins/utils/pluginAssetLoading', async (importOriginal) => ({
  ...(await importOriginal<typeof PluginAssetLoading>()),
  importPluginModule: vi.fn(async () => ({ start: pluginModule.start })),
}));

const globalPlugin: Plugin = {
  name: 'global-demo',
  displayName: 'Global Demo',
  version: '1.0.0',
  description: '',
  author: '',
  icon: '',
  type: 'module',
  slot: 'tab',
  entry: 'index.js',
  server: null,
  scripts: ['dist/global.js'],
  styles: ['theme.css'],
  permissions: [],
  enabled: true,
  serverRunning: false,
  dirName: 'global-demo',
  repoUrl: null,
};

let listedPlugins: Plugin[] = [];
let listFails = false;

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/plugins') {
      if (listFails) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ plugins: listedPlugins }), { status: 200 });
    }
    if (url === '/api/plugins/global-demo/enable' || url === '/api/plugins/global-demo') {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url === '/api/plugins/global-demo/update') {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url === '/api/plugins/global-demo/assets/theme.css') {
      return new Response('body { --demo: 1; }', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
}

const pluginStyles = () => document.head.querySelectorAll('style[data-plugin="global-demo"]');

// Lets a test refresh or update plugins the way the settings tab would.
type CapturedActions = 'refreshPlugins' | 'updatePlugin' | 'togglePlugin' | 'uninstallPlugin';
const captured: Pick<ReturnType<typeof usePlugins>, CapturedActions> = {
  refreshPlugins: async () => undefined,
  updatePlugin: async () => ({ success: false }),
  togglePlugin: async () => ({ success: false, error: null }),
  uninstallPlugin: async () => ({ success: false }),
};
function CaptureRefresh() {
  const { refreshPlugins, updatePlugin, togglePlugin, uninstallPlugin } = usePlugins();
  useEffect(() => {
    Object.assign(captured, { refreshPlugins, updatePlugin, togglePlugin, uninstallPlugin });
  }, [refreshPlugins, updatePlugin, togglePlugin, uninstallPlugin]);
  return null;
}
const refreshPlugins = () => captured.refreshPlugins();

function renderLoader() {
  return render(
    <PluginsProvider>
      <CaptureRefresh />
      <PluginGlobalAssets />
    </PluginsProvider>,
  );
}

describe('PluginGlobalAssets loads manifest-declared scripts and styles on every page', () => {
  beforeEach(() => {
    listedPlugins = [globalPlugin];
    listFails = false;
    pluginModule.start.mockReset().mockReturnValue(pluginModule.cleanup);
    pluginModule.cleanup.mockReset();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.querySelectorAll('style[data-plugin]').forEach((element) => element.remove());
  });

  it('injects the styles and starts the scripts of an enabled plugin', async () => {
    renderLoader();

    await waitFor(() => expect(pluginModule.start).toHaveBeenCalledTimes(1));
    expect(pluginStyles()).toHaveLength(1);
    expect(pluginStyles()[0].textContent).toBe('body { --demo: 1; }');
    expect(pluginStyles()[0].getAttribute('data-plugin-asset')).toBe('theme.css');
    expect(typeof pluginModule.start.mock.calls[0][0].rpc).toBe('function');
  });

  it('loads nothing for a disabled plugin', async () => {
    listedPlugins = [{ ...globalPlugin, enabled: false }];
    renderLoader();

    await act(async () => { await refreshPlugins(); });
    expect(pluginModule.start).not.toHaveBeenCalled();
    expect(pluginStyles()).toHaveLength(0);
  });

  it('runs the cleanup and removes the styles when the plugin is disabled', async () => {
    renderLoader();
    await waitFor(() => expect(pluginModule.start).toHaveBeenCalledTimes(1));

    listedPlugins = [{ ...globalPlugin, enabled: false }];
    await act(async () => { await refreshPlugins(); });

    expect(pluginModule.cleanup).toHaveBeenCalledTimes(1);
    expect(pluginStyles()).toHaveLength(0);
  });

  it('unloads a plugin on a confirmed disable or uninstall even when the list refetch fails', async () => {
    for (const confirm of [
      () => captured.togglePlugin('global-demo', false),
      () => captured.uninstallPlugin('global-demo'),
    ]) {
      listFails = false;
      pluginModule.start.mockClear();
      pluginModule.cleanup.mockClear();
      const { unmount } = renderLoader();
      await waitFor(() => expect(pluginModule.start).toHaveBeenCalledTimes(1));

      listFails = true;
      await act(async () => { await confirm(); });

      expect(pluginModule.cleanup).toHaveBeenCalledTimes(1);
      expect(pluginStyles()).toHaveLength(0);
      unmount();
    }
  });

  it('reloads a plugin after an update that left its manifest unchanged', async () => {
    renderLoader();
    await waitFor(() => expect(pluginModule.start).toHaveBeenCalledTimes(1));

    await act(async () => { await captured.updatePlugin('global-demo'); });

    await waitFor(() => expect(pluginModule.start).toHaveBeenCalledTimes(2));
    expect(pluginModule.cleanup).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pluginStyles()).toHaveLength(1));
  });

  it('does not reload a plugin when the list is refreshed unchanged', async () => {
    renderLoader();
    await waitFor(() => expect(pluginModule.start).toHaveBeenCalledTimes(1));

    await act(async () => { await refreshPlugins(); });

    expect(pluginModule.start).toHaveBeenCalledTimes(1);
    expect(pluginModule.cleanup).not.toHaveBeenCalled();
    expect(pluginStyles()).toHaveLength(1);
  });
});
