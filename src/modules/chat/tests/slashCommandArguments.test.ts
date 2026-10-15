import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import type { PermissionMode, Project } from '@/shared/types';

/**
 * Regression guard for #1523: the composer cut a custom command's arguments at
 * the first line break (`(.*)` stops at `\n`) and only ever sent them as
 * whitespace-split tokens, so a multi-line brief reached `$ARGUMENTS` as its
 * first line. The execute request must carry the raw text typed after the
 * command name, like the Claude Code CLI substitutes it.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };

const ECHO_COMMAND = {
  name: '/echo',
  path: '/tmp/project-one/.claude/commands/echo.md',
  namespace: 'project',
  description: 'Repeat the arguments',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

const executeBodies = () => fetchMock.mock.calls
  .filter(([url]) => String(url) === '/api/commands/execute')
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

const renderComposer = () => {
  const sent: Array<{ type: string; content?: string }> = [];
  const view = renderHook(() =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: { id: 'session-existing' },
      currentSessionId: 'session-existing',
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: false,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string; content?: string }); },
      onSessionEstablished: () => undefined,
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }));
  return { view, chatSends: () => sent.filter((message) => message.type === 'chat.send') };
};

// Types `text` into the composer once the command list has loaded, presses
// Enter, and returns the body of the `/api/commands/execute` request it made.
const submitCommand = async (text: string) => {
  const { view, chatSends } = renderComposer();
  await waitFor(() => assert.equal(view.result.current.slashCommandsCount, 1));
  await act(async () => { view.result.current.setInput(text); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => assert.equal(executeBodies().length, 1, 'the input runs /echo through the execute endpoint'));
  return { body: executeBodies()[0], chatSends };
};

beforeEach(() => {
  fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url);
    if (target === '/api/commands/list' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse({ builtIn: [], custom: [ECHO_COMMAND], count: 1 }));
    }
    if (target.startsWith('/api/providers/claude/skills')) {
      return Promise.resolve(jsonResponse({ success: true, data: { skills: [] } }));
    }
    if (target === '/api/commands/execute' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse({ type: 'custom', command: '/echo', content: 'expanded', hasBashCommands: false }));
    }
    return Promise.resolve(jsonResponse([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('a multi-line argument reaches the execute request verbatim', async () => {
  const { body } = await submitCommand('/echo first line\nsecond line\n  indented   third');

  assert.equal(body.commandName, '/echo');
  assert.equal(body.rawArgs, 'first line\nsecond line\n  indented   third');
  // Positional `$1..$n` tokens now cover every line, not just the first.
  assert.deepEqual(body.args, ['first', 'line', 'second', 'line', 'indented', 'third']);
});

test('a command followed directly by a line break still runs with the following lines as its argument', async () => {
  const { body, chatSends } = await submitCommand('/echo\nsecond line\nthird line');

  assert.equal(body.commandName, '/echo');
  assert.equal(body.rawArgs, 'second line\nthird line');
  assert.deepEqual(body.args, ['second', 'line', 'third', 'line']);
  // The raw "/echo\n…" text is not sent to the agent as an ordinary message.
  assert.equal(chatSends().some((message) => message.content?.startsWith('/echo')), false);
});

test('a command with no argument sends empty arguments', async () => {
  const { body } = await submitCommand('/echo');

  assert.equal(body.rawArgs, '');
  assert.deepEqual(body.args, []);
});
