import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import type { PermissionMode, Project, SlashCommand } from '@/shared/types';

/**
 * Regression guard for #1523: the composer cut a custom command's arguments at
 * the first line break (`(.*)` stops at `\n`) and only ever sent them as
 * whitespace-split tokens, so a multi-line brief reached `$ARGUMENTS` as its
 * first line. The execute request must carry the raw text typed after the
 * command name, like the Claude Code CLI substitutes it. The expanded body
 * that comes back is then sent as the message and never run as a command again.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };

const ECHO_COMMAND = {
  name: '/echo',
  path: '/tmp/project-one/.claude/commands/echo.md',
  namespace: 'project',
  description: 'Repeat the arguments',
};

const OTHER_COMMAND = {
  name: '/other',
  path: '/tmp/project-one/.claude/commands/other.md',
  namespace: 'project',
  description: 'Another custom command',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
// The expanded body the mocked `/api/commands/execute` answers with.
let expandedContent = 'expanded';

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

const renderLoadedComposer = async () => {
  const composer = renderComposer();
  await waitFor(() => assert.equal(composer.view.result.current.slashCommandsCount, 2));
  return composer;
};

// Types `text` into the composer once the command list has loaded, presses
// Enter, and returns the body of the `/api/commands/execute` request it made.
const submitCommand = async (text: string) => {
  const { view, chatSends } = await renderLoadedComposer();
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
      return Promise.resolve(jsonResponse({ builtIn: [], custom: [ECHO_COMMAND, OTHER_COMMAND], count: 2 }));
    }
    if (target.startsWith('/api/providers/claude/skills')) {
      return Promise.resolve(jsonResponse({ success: true, data: { skills: [] } }));
    }
    if (target === '/api/commands/execute' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse({ type: 'custom', command: '/echo', content: expandedContent, hasBashCommands: false }));
    }
    return Promise.resolve(jsonResponse([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(async () => {
  // Ends, and lets drain, a re-submit loop a failing run may have left going,
  // so it cannot add execute requests to the next test's mock.
  expandedContent = 'expanded';
  await new Promise((resolve) => setTimeout(resolve, 50));
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

// The slash menu runs the picked command against the whole composer text.
const pickEchoFromMenu = async (text: string) => {
  const { view } = await renderLoadedComposer();
  await act(async () => { view.result.current.setInput(text); });
  await act(async () => {
    view.result.current.handleCommandSelect(ECHO_COMMAND as SlashCommand, 0, false);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => assert.equal(executeBodies().length, 1, 'the menu pick runs /echo'));
  return executeBodies()[0];
};

for (const [where, text] of [
  ['later in the composer', 'see /echo docs and\nmore\n/ech'],
  ['inside a longer word', '/echo2 docs\nmore'],
  ['inside a longer word and at the end', 'see /echo2 docs\nmore\n/echo'],
]) {
  test(`a menu pick takes no arguments from the command name ${where}`, async () => {
    const body = await pickEchoFromMenu(text);

    assert.equal(body.rawArgs, '');
    assert.deepEqual(body.args, []);
  });
}

test('a menu pick over a composer that opens with the command trims its argument text', async () => {
  const body = await pickEchoFromMenu('  /echo  hi there \n\n');

  assert.equal(body.rawArgs, 'hi there');
  assert.deepEqual(body.args, ['hi', 'there']);
});

for (const [opening, expandedBody] of [
  ['its own name and a space', '/echo again: hi'],
  ['its own name and a line break', '/echo\nhi'],
  ['another command and a line break', '/other\nplease review'],
]) {
  test(`an expanded body that opens with ${opening} is sent as the message, not run as a command`, async () => {
    expandedContent = expandedBody;
    const { view, chatSends } = await renderLoadedComposer();
    await act(async () => { view.result.current.setInput('/echo hi'); });
    await act(async () => {
      await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
    });

    // Re-interception would show up as a second execute request.
    await waitFor(() => assert.ok(chatSends().length > 0 || executeBodies().length > 1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    assert.deepEqual(executeBodies().map((body) => body.commandName), ['/echo']);
    assert.deepEqual(chatSends().map((message) => message.content), [expandedBody]);
  });
}

test('an expanded body that is exactly "help" is sent as the message, not opened as help', async () => {
  expandedContent = 'help';
  const { view, chatSends } = await renderLoadedComposer();
  await act(async () => { view.result.current.setInput('/echo hi'); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  await waitFor(() => assert.ok(chatSends().length > 0 || executeBodies().length > 1));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  assert.deepEqual(executeBodies().map((body) => body.commandName), ['/echo']);
  assert.deepEqual(chatSends().map((message) => message.content), ['help']);
});

test('a voice transcript sent straight away is still read as a command', async () => {
  // Only the re-submit of an expanded body skips interception; "stop and send"
  // goes through the same path as typing and pressing Enter.
  const { view, chatSends } = await renderLoadedComposer();
  await act(async () => { view.result.current.handleVoiceTranscript('/echo hi\nthere', true); });

  await waitFor(() => assert.equal(chatSends().length, 1));
  assert.deepEqual(executeBodies().map((body) => [body.commandName, body.rawArgs]), [['/echo', 'hi\nthere']]);
  assert.deepEqual(chatSends().map((message) => message.content), ['expanded']);
});
