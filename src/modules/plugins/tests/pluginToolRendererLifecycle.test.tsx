import assert from 'node:assert/strict';

import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, test, vi } from 'vitest';

import type { Plugin, Project } from '@/shared/types';
import type * as LoaderModule from '@/modules/plugins/tool-renderers/loadToolRendererModule';
import PluginToolRenderer from '@/modules/plugins/tool-renderers/PluginToolRenderer';

const renderTool = vi.fn();
let moduleLoads = 0;

vi.mock('@/shared/context/ThemeContext', () => ({ useTheme: () => ({ isDarkMode: false }) }));
vi.mock('@/shared/api', () => ({
  api: {
    plugins: {
      asset: vi.fn(async () => { moduleLoads += 1; return { ok: false, status: 500 }; }),
      rpc: vi.fn(),
    },
  },
}));
// The renderer only needs the module's renderTool; Blob-URL imports don't run under jsdom.
vi.mock('@/modules/plugins/tool-renderers/loadToolRendererModule', async (importOriginal) => {
  const actual = await importOriginal<typeof LoaderModule>();
  return { ...actual, loadToolRendererModule: vi.fn(async () => ({ renderTool })) };
});

const plugin: Plugin = {
  name: 'p', displayName: 'P', version: '1', description: '', author: '', icon: '', type: 'module', slot: 'tab',
  entry: 'dist/index.js', server: null, permissions: [], enabled: true, serverRunning: false, dirName: 'p', repoUrl: null,
  toolRenderers: ['mcp__p__*'],
};
const project = (id: string): Project => ({ projectId: id, displayName: id, fullPath: `/${id}` });

beforeEach(() => {
  renderTool.mockReset();
  moduleLoads = 0;
});


test('a renderer whose update throws is released and the host rendering returns', async () => {
  const destroy = vi.fn();
  renderTool.mockImplementation((node: HTMLElement) => {
    node.textContent = 'plugin row';
    let calls = 0;
    // The first update (on becoming ready) succeeds; a later one throws.
    return { update: () => { calls += 1; if (calls > 1) throw new Error('boom'); }, destroy };
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const view = (status: 'running' | 'completed') => (
    <MemoryRouter>
      <PluginToolRenderer plugin={plugin} toolName="mcp__p__x" toolInput={{}} status={status} fallback={<span>host row</span>} />
    </MemoryRouter>
  );
  const { rerender } = render(view('running'));
  // Compare booleans: asserting on a DOM node makes every failed retry format the whole jsdom element.
  await waitFor(() => assert.equal(screen.queryByText('host row') === null, true, 'host row still shown'));
  await act(async () => { rerender(view('completed')); });
  await waitFor(() => screen.getByText('host row'));
  assert.equal(destroy.mock.calls.length, 1);
});

test('changing the selected project pushes an update to the renderer', async () => {
  const update = vi.fn();
  renderTool.mockImplementation(() => ({ update }));
  const view = (p: Project) => (
    <MemoryRouter>
      <PluginToolRenderer plugin={plugin} toolName="mcp__p__x" toolInput={{}} status="completed" selectedProject={p} fallback={<span>host</span>} />
    </MemoryRouter>
  );
  const { rerender } = render(view(project('a')));
  await waitFor(() => assert.equal(renderTool.mock.calls.length, 1));
  await waitFor(() => assert.equal(screen.queryByText('host') === null, true, 'host row still shown'));
  const before = update.mock.calls.length;
  await act(async () => { rerender(view(project('b'))); });
  await waitFor(() => assert.ok(update.mock.calls.length > before));
  assert.equal(update.mock.calls.at(-1)?.[0].project.name, 'b');
});

test('a replaced renderer gets its own node, so a late one cannot touch the new output', async () => {
  let releaseFirst: (() => void) | null = null;
  let lateDestroyedAfterFresh: boolean | null = null;
  const nodes: HTMLElement[] = [];
  renderTool.mockImplementation((node: HTMLElement) => {
    nodes.push(node);
    if (nodes.length === 1) {
      // The late renderer hands back a destroy() that wipes "its" node, as a careless plugin might.
      return new Promise((resolve) => {
        releaseFirst = () => {
          node.textContent = 'stale';
          resolve({ destroy: () => { lateDestroyedAfterFresh = /fresh/.test(container.textContent ?? ''); node.replaceChildren(); } });
        };
      });
    }
    node.textContent = 'fresh';
    return {};
  });
  const view = (toolName: string) => (
    <MemoryRouter>
      <PluginToolRenderer plugin={plugin} toolName={toolName} toolInput={{}} status="completed" fallback={<span>host</span>} />
    </MemoryRouter>
  );
  const { rerender, container } = render(view('mcp__p__one'));
  await waitFor(() => assert.equal(nodes.length, 1));
  await act(async () => { rerender(view('mcp__p__two')); });
  await waitFor(() => screen.getByText('fresh'));
  await act(async () => { releaseFirst?.(); });
  // The late handle is destroyed as soon as it arrives, after the replacement is showing, and cannot touch it.
  assert.equal(lateDestroyedAfterFresh, true);
  assert.notEqual(nodes[0], nodes[1]);
  assert.equal(nodes[0].isConnected, false);
  assert.match(container.textContent ?? '', /fresh/);
  assert.doesNotMatch(container.textContent ?? '', /stale/);
});

test('a stale renderer destroying its own node leaves the replacement intact', async () => {
  const nodes: HTMLElement[] = [];
  renderTool.mockImplementation((node: HTMLElement) => {
    nodes.push(node);
    node.textContent = nodes.length === 1 ? 'old' : 'fresh';
    // A destroy that wipes "its" output, as a careless plugin might.
    return { destroy: () => { node.replaceChildren(); node.textContent = ''; } };
  });
  const view = (toolName: string) => (
    <MemoryRouter>
      <PluginToolRenderer plugin={plugin} toolName={toolName} toolInput={{}} status="completed" fallback={<span>host</span>} />
    </MemoryRouter>
  );
  const { rerender, container } = render(view('mcp__p__one'));
  await waitFor(() => assert.equal(screen.queryByText('old') === null, false, 'first renderer not shown'));
  await act(async () => { rerender(view('mcp__p__two')); });
  await waitFor(() => assert.equal(screen.queryByText('fresh') === null, false, 'replacement not shown'));
  assert.match(container.textContent ?? '', /fresh/);
  assert.equal(nodes[0].isConnected, false);
});

test('a project path change with an empty fullPath still updates the renderer', async () => {
  const update = vi.fn();
  renderTool.mockImplementation(() => ({ update }));
  const view = (path: string) => (
    <MemoryRouter>
      <PluginToolRenderer plugin={plugin} toolName="mcp__p__x" toolInput={{}} status="completed"
        selectedProject={{ projectId: 'same', displayName: 'same', fullPath: '', path }} fallback={<span>host</span>} />
    </MemoryRouter>
  );
  const { rerender } = render(view('/a'));
  await waitFor(() => assert.equal(renderTool.mock.calls.length, 1));
  await waitFor(() => assert.equal(screen.queryByText('host') === null, true, 'host row still shown'));
  const before = update.mock.calls.length;
  await act(async () => { rerender(view('/b')); });
  await waitFor(() => assert.ok(update.mock.calls.length > before, 'update not called'));
  assert.equal(update.mock.calls.at(-1)?.[0].project.path, '/b');
});
