import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import type { LLMProvider, PermissionMode, Project, ProjectSession } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * The composer resolves the tool-permission settings it sends with every
 * `chat.send` from a per-provider preference key. That lookup used to be a
 * nested ternary whose last branch was Claude's key, so a provider without its
 * own arm silently inherited Claude's `allowedTools` and, worse, Claude's
 * `skipPermissions`.
 *
 * These tests drive the real hook: they seed the preference store, submit a
 * message and read the options handed to `sendMessage`, so pointing the
 * composer's lookup back at `'claudePermissions'` fails them.
 */

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};

const SESSION: ProjectSession = { id: 'session-1' };

type SentMessage = {
  type: string;
  options?: {
    toolsSettings?: { allowedTools?: string[]; skipPermissions?: boolean };
    skipPermissions?: boolean;
  };
};

/** Sends one message through the real submit path and returns its `chat.send` options. */
const submit = async (provider: LLMProvider) => {
  const sent: SentMessage[] = [];
  const view = renderHook(() =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      currentSessionId: SESSION.id,
      provider,
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: false,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => {
        sent.push(message as SentMessage);
      },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );

  await act(async () => {
    view.result.current.setInput('hello');
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  const send = sent.find((message) => message.type === 'chat.send');
  assert.ok(send, 'expected the composer to dispatch a chat.send');
  return send.options ?? {};
};

const seedAllProviderSettings = () => {
  writeUserPreference('claudePermissions', {
    allowedTools: ['claude-tool'],
    skipPermissions: true,
  });
  writeUserPreference('cursorPermissions', {
    allowedTools: ['cursor-tool'],
    skipPermissions: false,
  });
  writeUserPreference('codexPermissions', {
    allowedTools: ['codex-tool'],
    skipPermissions: false,
  });
  writeUserPreference('opencodePermissions', {
    allowedTools: ['opencode-tool'],
    skipPermissions: false,
  });
};

beforeEach(() => {
  // The composer's slash-command hook fetches commands and skills on mount.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })),
  );
  // The preference store keeps its copy in memory, so clearing localStorage is
  // not enough to give each case a store with nothing in it.
  resetUserPreferences();
  localStorage.clear();
});

afterEach(() => {
  // Also drops the debounced save the seeding queued, so no preference write
  // outlives the stubbed fetch.
  resetUserPreferences();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test.each<[LLMProvider, string]>([
  ['claude', 'claude-tool'],
  ['cursor', 'cursor-tool'],
  ['codex', 'codex-tool'],
  ['opencode', 'opencode-tool'],
])('a %s send carries the tools stored under that provider own preference', async (provider, tool) => {
  seedAllProviderSettings();

  const options = await submit(provider);

  assert.deepEqual(options.toolsSettings?.allowedTools, [tool]);
});

test('skipPermissions follows the sending provider, not Claude', async () => {
  seedAllProviderSettings();

  const claudeOptions = await submit('claude');
  assert.equal(claudeOptions.skipPermissions, true);

  const opencodeOptions = await submit('opencode');
  assert.equal(opencodeOptions.skipPermissions, false);
});

test('a provider with nothing stored sends empty tool settings, not Claude settings', async () => {
  writeUserPreference('claudePermissions', {
    allowedTools: ['claude-tool'],
    disallowedTools: ['nope'],
    skipPermissions: true,
  });

  const options = await submit('cursor');

  assert.deepEqual(options.toolsSettings, {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false,
  });
  assert.equal(options.skipPermissions, false);
});
