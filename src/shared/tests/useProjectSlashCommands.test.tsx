import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * The composer's `/` menu and the quick settings Commands tab must offer the
 * same list, so both read it from this hook. It assembles the server's
 * built-in and custom commands with the provider's skills — each skill once,
 * however many plugin folders expose it — and reports loading and failure so a
 * list can tell "nothing yet" from "nothing" from "broken". For Claude it
 * adds `/btw` and the commands the CLI runs itself, after everything else.
 */

const listCommands = vi.fn();
const listSkills = vi.fn();
const listCliCommands = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    commands: { list: (...args: unknown[]) => listCommands(...args) },
    providers: {
      skills: (...args: unknown[]) => listSkills(...args),
      claudeCliCommands: (...args: unknown[]) => listCliCommands(...args),
    },
  },
}));

const project: Project = {
  projectId: 'p1',
  displayName: 'Triage',
  fullPath: '/work/triage-repo',
};

const jsonResponse = (body: unknown, ok = true) => ({ ok, json: async () => body });

beforeEach(() => {
  listCommands.mockReset();
  listSkills.mockReset();
  listCliCommands.mockReset();
  listCliCommands.mockResolvedValue(jsonResponse({ success: true, data: { commands: [] } }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

test('assembles built-in, deduped skills and custom commands in that order', async () => {
  listCommands.mockResolvedValue(jsonResponse({
    builtIn: [{ name: '/help', description: 'Show help' }],
    custom: [{ name: '/deploy', description: 'Deploy it' }],
  }));
  listSkills.mockResolvedValue(jsonResponse({
    success: true,
    data: {
      skills: [
        { name: 'review', command: '/review', scope: 'plugin', description: 'Review code', pluginName: 'a', sourcePath: '/a' },
        { name: 'review', command: '/review', scope: 'plugin', description: 'Review code', pluginName: 'b', sourcePath: '/b' },
        { name: 'commit', command: '/commit', scope: 'user', description: 'Write a commit' },
      ],
    },
  }));

  const { useProjectSlashCommands } = await import('@/shared/hooks/useProjectSlashCommands');
  const { result } = renderHook(() => useProjectSlashCommands(project, 'claude'));

  await waitFor(() => assert.equal(result.current.isLoading, false));
  assert.deepEqual(
    result.current.commands.map((command) => [command.name, command.type]),
    [['/help', 'built-in'], ['/review', 'skill'], ['/commit', 'skill'], ['/deploy', 'custom'], ['/btw', 'cli']],
  );
  const review = result.current.commands[1];
  assert.equal(review.namespace, 'skill');
  assert.equal(review.path, '/a');
  assert.deepEqual(review.metadata, {
    type: 'plugin',
    scope: 'plugin',
    sourcePath: '/a',
    pluginName: 'a',
    pluginId: undefined,
    skillName: 'review',
  });
  assert.equal(result.current.error, false);
  assert.deepEqual(listCommands.mock.calls[0], ['/work/triage-repo']);
  assert.deepEqual(listSkills.mock.calls[0], ['claude', { workspacePath: '/work/triage-repo' }]);
});

test('no project yields an empty list without a request', async () => {
  const { useProjectSlashCommands } = await import('@/shared/hooks/useProjectSlashCommands');
  const { result } = renderHook(() => useProjectSlashCommands(null, 'claude'));

  await waitFor(() => assert.equal(result.current.isLoading, false));
  assert.deepEqual(result.current.commands, []);
  assert.equal(result.current.error, false);
  assert.equal(listCommands.mock.calls.length, 0);
});

test('a failed command request yields an empty list and the error flag', async () => {
  listCommands.mockResolvedValue(jsonResponse({}, false));

  const { useProjectSlashCommands } = await import('@/shared/hooks/useProjectSlashCommands');
  const { result } = renderHook(() => useProjectSlashCommands(project, 'claude'));

  await waitFor(() => assert.equal(result.current.error, true));
  assert.deepEqual(result.current.commands, []);
  assert.equal(result.current.isLoading, false);
});

test('a failed skills request keeps the server commands', async () => {
  listCommands.mockResolvedValue(jsonResponse({ builtIn: [{ name: '/clear' }], custom: [] }));
  listSkills.mockResolvedValue(jsonResponse({}, false));

  const { useProjectSlashCommands } = await import('@/shared/hooks/useProjectSlashCommands');
  const { result } = renderHook(() => useProjectSlashCommands(project, 'claude'));

  await waitFor(() => assert.equal(result.current.isLoading, false));
  assert.deepEqual(result.current.commands.map((command) => command.name), ['/clear', '/btw']);
  assert.equal(result.current.error, false);
});

test('a disabled consumer does not request until it is enabled', async () => {
  listCommands.mockResolvedValue(jsonResponse({ builtIn: [{ name: '/help' }], custom: [] }));
  listSkills.mockResolvedValue(jsonResponse({ data: { skills: [] } }));

  const { useProjectSlashCommands } = await import('@/shared/hooks/useProjectSlashCommands');
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) => useProjectSlashCommands(project, 'claude', { enabled }),
    { initialProps: { enabled: false } },
  );

  assert.equal(listCommands.mock.calls.length, 0);
  assert.deepEqual(result.current.commands, []);

  rerender({ enabled: true });
  await waitFor(() => assert.equal(result.current.commands.length, 2), '/help and /btw');
  assert.equal(listCommands.mock.calls.length, 1);
});

test('Claude\'s own CLI commands follow the rest, without repeating a name already listed', async () => {
  listCommands.mockResolvedValue(jsonResponse({ builtIn: [{ name: '/cost' }], custom: [] }));
  listSkills.mockResolvedValue(jsonResponse({ data: { skills: [] } }));
  listCliCommands.mockResolvedValue(jsonResponse({
    success: true,
    data: {
      commands: [
        { name: '/usage', description: 'Show plan usage', argumentHint: '' },
        { name: '/cost', description: 'Alias row from the CLI', argumentHint: '' },
        { name: '/compact', description: 'Compact the conversation', argumentHint: '<instructions>' },
      ],
    },
  }));

  const { useProjectSlashCommands } = await import('@/shared/hooks/useProjectSlashCommands');
  const { result } = renderHook(() => useProjectSlashCommands(project, 'claude'));

  await waitFor(() => assert.equal(result.current.isLoading, false));
  assert.deepEqual(
    result.current.commands.map((command) => [command.name, command.type]),
    [['/cost', 'built-in'], ['/btw', 'cli'], ['/usage', 'cli'], ['/compact', 'cli']],
  );
  assert.equal(result.current.commands.at(-1)?.argumentHint, '<instructions>');
  assert.deepEqual(listCliCommands.mock.calls[0], ['/work/triage-repo']);
});

test('a failed CLI command list keeps the rest of the menu', async () => {
  listCommands.mockResolvedValue(jsonResponse({ builtIn: [{ name: '/help' }], custom: [] }));
  listSkills.mockResolvedValue(jsonResponse({ data: { skills: [] } }));
  listCliCommands.mockRejectedValue(new Error('offline'));

  const { useProjectSlashCommands } = await import('@/shared/hooks/useProjectSlashCommands');
  const { result } = renderHook(() => useProjectSlashCommands(project, 'claude'));

  await waitFor(() => assert.equal(result.current.isLoading, false));
  assert.deepEqual(result.current.commands.map((command) => command.name), ['/help', '/btw']);
  assert.equal(result.current.error, false);
});
