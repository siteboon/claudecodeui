import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import type * as PluginModuleLoader from '@/modules/plugins/pluginModuleLoader';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import PluginHostLayer from '@/modules/plugins/PluginHostLayer';
import type { Plugin } from '@/shared/types';

// The resident layer loads each bundle through `loadPluginModule`, so stubbing
// that module is the only way to observe the mount/unmount lifecycle without a
// real plugin on disk. `createPluginHostApi` stays real, because the contract it
// publishes to a plugin is exactly what these tests hold the layer to.
const loadPluginModule = vi.hoisted(() => vi.fn());
vi.mock('@/modules/plugins/pluginModuleLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof PluginModuleLoader>();
  return { ...actual, loadPluginModule };
});

// The installed-plugin list is controlled directly instead of through the real
// provider, so changing the resident set never depends on a fetch settling.
const pluginList = vi.hoisted(() => ({ current: [] as Plugin[] }));
vi.mock('@/modules/plugins/context/PluginsContext', () => ({
  usePlugins: () => ({
    plugins: pluginList.current,
    loading: false,
    pluginsError: null,
    refreshPlugins: async () => {},
    installPlugin: async () => ({ success: true }),
    uninstallPlugin: async () => ({ success: true }),
    updatePlugin: async () => ({ success: true }),
    togglePlugin: async () => ({ success: true, error: null }),
  }),
  PluginsProvider: ({ children }: { children: ReactNode }) => children,
}));

const residentPlugin = (name: string): Plugin => ({
  name,
  displayName: name,
  version: '1.0.0',
  description: '',
  author: '',
  icon: '',
  type: 'module',
  slot: 'tab',
  entry: 'index.js',
  server: null,
  permissions: [],
  alwaysMount: true,
  enabled: true,
  serverRunning: false,
  dirName: name,
  repoUrl: null,
});

/** Minimal project shape — the layer only reads the fields it forwards to the plugin context. */
const project = (projectId: string) => ({
  projectId,
  path: `/tmp/${projectId}`,
  fullPath: `/tmp/${projectId}`,
  displayName: projectId,
}) as never;

type HostLike = { onContextChange: (callback: (context: unknown) => void) => () => void };

/** Renders the layer against a fixed plugin list; the mocked provider replays this array. */
function renderLayer(plugins: Plugin[], selectedProject: unknown = null) {
  pluginList.current = plugins;
  return render(
    <ThemeProvider>
      <PluginHostLayer selectedProject={selectedProject as never} selectedSession={null} />
    </ThemeProvider>,
  );
}

/** A bundle that records its own lifecycle calls. */
function residentBundle() {
  const calls = { mount: 0, unmount: 0 };
  // Parameters are declared so the mock records its arguments; without them the
  // call tuple is `[]` and reading `calls[0][0]` does not typecheck.
  const bundle = {
    mount: vi.fn(async (_container: HTMLElement) => { calls.mount += 1; }),
    unmount: vi.fn((_container: HTMLElement) => { calls.unmount += 1; }),
  };
  return { bundle, calls };
}

describe('PluginHostLayer mounts resident plugins once and tears them down exactly once', () => {
  beforeEach(() => {
    loadPluginModule.mockReset();
    pluginList.current = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts an enabled alwaysMount plugin into its own container', async () => {
    const { bundle, calls } = residentBundle();
    loadPluginModule.mockResolvedValue(bundle);

    const { container } = renderLayer([residentPlugin('resident-demo')]);

    await waitFor(() => expect(calls.mount).toBe(1));
    expect(loadPluginModule).toHaveBeenCalledWith('resident-demo', 'index.js');
    const mountTarget = container.querySelector('[data-cloudcli-resident-plugin="resident-demo"]');
    expect(mountTarget).toBeTruthy();
    // mount receives its own detached container, not the layer element itself.
    expect(bundle.mount.mock.calls[0][0]).toBe(mountTarget);
  });

  it('does not mount a plugin that is disabled or not alwaysMount', async () => {
    loadPluginModule.mockResolvedValue(residentBundle().bundle);

    renderLayer([
      { ...residentPlugin('disabled-demo'), enabled: false },
      { ...residentPlugin('tab-only-demo'), alwaysMount: false },
    ]);

    // Give the effect a chance to run before asserting nothing happened.
    await waitFor(() => expect(pluginList.current).toHaveLength(2));
    expect(loadPluginModule).not.toHaveBeenCalled();
  });

  it('unmounts once and removes the container when the layer unmounts', async () => {
    const { bundle, calls } = residentBundle();
    loadPluginModule.mockResolvedValue(bundle);

    const { container, unmount } = renderLayer([residentPlugin('resident-demo')]);
    await waitFor(() => expect(calls.mount).toBe(1));

    unmount();

    expect(calls.unmount).toBe(1);
    expect(container.querySelector('[data-cloudcli-resident-plugin="resident-demo"]')).toBeNull();
  });

  it('drops the callbacks of a torn-down mount, so a stale one is never notified again', async () => {
    // Each mount registers a fresh callback. A callback left behind in the shared
    // registry by a previous mount keeps firing on every context update, which is
    // exactly what a cleanup that forgets to unsubscribe produces.
    const callbacks: Array<ReturnType<typeof vi.fn>> = [];
    loadPluginModule.mockImplementation(async () => ({
      mount: async (_container: HTMLElement, host: HostLike) => {
        const callback = vi.fn();
        callbacks.push(callback);
        host.onContextChange(callback);
      },
      unmount: vi.fn(),
    }));

    const tree = (plugins: Plugin[], selectedProject: unknown) => (
      <ThemeProvider>
        <PluginHostLayer selectedProject={selectedProject as never} selectedSession={null} />
      </ThemeProvider>
    );

    const { rerender } = renderLayer([residentPlugin('resident-demo')], project('p1'));
    await waitFor(() => expect(callbacks).toHaveLength(1));
    const staleCallback = callbacks[0];

    // Dropping the plugin empties the resident set, which tears its mount down.
    pluginList.current = [];
    rerender(tree(pluginList.current, project('p1')));
    await waitFor(() => expect(loadPluginModule).toHaveBeenCalledTimes(1));
    staleCallback.mockClear();

    // The mount is gone, so this context change must not reach it.
    rerender(tree(pluginList.current, project('p2')));
    expect(staleCallback).not.toHaveBeenCalled();

    // Bringing it back registers a new callback, which does receive updates.
    pluginList.current = [residentPlugin('resident-demo')];
    rerender(tree(pluginList.current, project('p3')));
    await waitFor(() => expect(callbacks).toHaveLength(2));

    rerender(tree(pluginList.current, project('p4')));
    await waitFor(() => expect(callbacks[1]).toHaveBeenCalled());
    expect(staleCallback).not.toHaveBeenCalled();
  });

  it('unmounts a mount that only settles after the layer already unmounted', async () => {
    const calls = { mount: 0, unmount: 0 };
    // Assigned inside the mount promise, so it is only callable once the layer
    // has actually reached `mount()` — the definite-assignment form lets the
    // post-unmount call site stay free of a null check.
    const settle = { resolve: null as null | (() => void) };
    loadPluginModule.mockResolvedValue({
      mount: vi.fn(() => {
        calls.mount += 1;
        return new Promise<void>((resolve) => { settle.resolve = resolve; });
      }),
      unmount: vi.fn((_container: HTMLElement) => { calls.unmount += 1; }),
    });

    const { unmount } = renderLayer([residentPlugin('slow-demo')]);
    await waitFor(() => expect(calls.mount).toBe(1));

    // The layer goes away while `mount()` is still pending.
    unmount();
    expect(calls.unmount).toBe(0);

    settle.resolve?.();
    await waitFor(() => expect(calls.unmount).toBe(1));

    // Settling late must not produce a second teardown. A second `waitFor` here
    // would pass on its very first poll — the count is already 1 — and so could
    // never observe a duplicate queued in the meantime. Flushing microtasks and
    // zero-delay timers drains that window, then one assertion covers it.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(calls.unmount).toBe(1);
  });

  it('never calls unmount for a mount that rejected', async () => {
    const calls = { mount: 0, unmount: 0 };
    loadPluginModule.mockResolvedValue({
      mount: vi.fn(async () => {
        calls.mount += 1;
        throw new Error('plugin exploded');
      }),
      unmount: vi.fn(() => { calls.unmount += 1; }),
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderLayer([residentPlugin('broken-demo')]);

    await waitFor(() => expect(calls.mount).toBe(1));
    unmount();

    // A mount that never completed has nothing to tear down, and calling
    // unmount() against it is what the review flagged.
    expect(calls.unmount).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('skips a module that does not export mount()', async () => {
    loadPluginModule.mockResolvedValue({});

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLayer([residentPlugin('empty-demo')]);

    await waitFor(() => expect(loadPluginModule).toHaveBeenCalledWith('empty-demo', 'index.js'));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });
});
