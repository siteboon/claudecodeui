import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * The composer's `/` menu and the quick settings Commands tab must offer the
 * same list, so both read it from this hook. It assembles the server's
 * built-in and custom commands with the provider's skills — each skill once,
 * however many plugin folders expose it — and reports loading and failure so a
 * list can tell "nothing yet" from "nothing" from "broken".
 */

const listCommands = vi.fn();
const listSkills = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    commands: { list: (...args: unknown[]) => listCommands(...args) },
    providers: { skills: (...args: unknown[]) => listSkills(...args) },
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
    [['/help', 'built-in'], ['/review', 'skill'], ['/commit', 'skill'], ['/deploy', 'custom']],
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
  assert.deepEqual(result.current.commands.map((command) => command.name), ['/clear']);
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
  await waitFor(() => assert.equal(result.current.commands.length, 1));
  assert.equal(listCommands.mock.calls.length, 1);
});
