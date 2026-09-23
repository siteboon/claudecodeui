import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { useChatProviderState } from '@/modules/chat/hooks/useChatProviderState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import { resetUserPreferences } from '@/shared/userSettings';
import type { ChatMessage, PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * Issue #1315: `/model claude-fable-5-1` typed in the chat used to go to the
 * Claude CLI as a prompt. The CLI answered "Set model to Fable 5.1 for this
 * session only", but that only lasted for that one CLI process: the next turn
 * started a new process with the composer's model, so the session kept running
 * (and showing) the old model. `/model <id>` is now a built-in that applies the
 * id the way the composer's model picker does.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const CATALOG = {
  OPTIONS: [{ value: 'default', label: 'Default' }, { value: 'sonnet', label: 'Sonnet' }],
  DEFAULT: 'default',
};

const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });

// What the Commands module answers for `/model <id>` (see commands.routes.ts).
const executeCommand = vi.fn(async (request: { commandName: string; args: string[] }) => okJson({
  type: 'builtin',
  action: 'model',
  command: request.commandName,
  data: {
    provider: 'claude',
    model: request.args[0],
    inCatalog: CATALOG.OPTIONS.some((option) => option.value === request.args[0]),
  },
}));

vi.mock('@/shared/api', () => ({
  api: {
    getFiles: () => okJson([]),
    user: {
      drafts: () => okJson({ success: true, drafts: [] }),
      saveDraft: () => okJson({ success: true }),
      deleteDraft: () => okJson({ success: true }),
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    commands: {
      list: () => okJson({
        builtIn: [{ name: '/model', description: 'Switch the model', namespace: 'builtin', metadata: { type: 'builtin' } }],
        custom: [],
      }),
      execute: (request: { commandName: string; args: string[] }) => executeCommand(request),
    },
    files: { search: () => okJson({ success: true, files: [] }) },
    providers: {
      skills: () => okJson({ success: true, data: { skills: [] } }),
      models: () => okJson({ success: true, data: { models: CATALOG } }),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: { model: 'sonnet', effort: null, source: 'session' } }),
      setSessionActiveModel: (_provider: string, sessionId: string, model: string) => okJson({
        success: true,
        data: { provider: 'claude', sessionId, model, effort: null, source: 'session' },
      }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
    },
  },
}));

type SelectProviderModel = NonNullable<Parameters<typeof useChatComposerState>[0]['onSelectProviderModel']>;

const renderComposer = (session: ProjectSession | null, onSelectProviderModel: SelectProviderModel) => {
  const sent: Array<{ type: string }> = [];
  const messages: ChatMessage[] = [];
  const view = renderHook(() => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: session,
    currentSessionId: session?.id ?? null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'sonnet',
    currentProviderEffort: 'medium',
    isLoading: false,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage: (message) => { sent.push(message as { type: string }); },
    onSelectProviderModel,
    scrollToBottom: () => undefined,
    addMessage: (message) => { messages.push(message); },
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }));
  return { view, sent, messages };
};

const submit = async (view: ReturnType<typeof renderComposer>['view'], text: string) => {
  // The composer only intercepts commands its slash-command list contains.
  await waitFor(() => assert.equal(view.result.current.slashCommandsCount, 1));
  await act(async () => { view.result.current.setInput(text); });
  await act(async () => { await view.result.current.handleSubmit({ preventDefault: () => undefined } as never); });
};

beforeEach(() => {
  localStorage.clear();
  resetChatDrafts();
  resetUserPreferences();
  executeCommand.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('/model <id> in an open session switches that session instead of prompting the CLI', async () => {
  const onSelectProviderModel = vi.fn<SelectProviderModel>(async (_provider, model) => ({ scope: 'session', model }));
  const { view, sent, messages } = renderComposer({ id: 'session-1' }, onSelectProviderModel);

  await submit(view, '/model claude-fable-5-1');

  await waitFor(() => assert.equal(messages.length, 1));
  assert.deepEqual(onSelectProviderModel.mock.calls, [['claude', 'claude-fable-5-1', 'session-1']]);
  assert.equal(messages[0].content, 'This session now uses claude-fable-5-1.');
  assert.equal(sent.filter((message) => message.type === 'chat.send').length, 0, '/model must not reach the CLI');
});

test('/model with a catalog model before the first message sets the default for new chats', async () => {
  const onSelectProviderModel = vi.fn<SelectProviderModel>(async (_provider, model) => ({ scope: 'default', model }));
  const { view, messages } = renderComposer(null, onSelectProviderModel);

  await submit(view, '/model sonnet');

  await waitFor(() => assert.equal(messages.length, 1));
  assert.deepEqual(onSelectProviderModel.mock.calls, [['claude', 'sonnet', null]]);
  assert.equal(messages[0].content, 'New chats now use sonnet.');
});

test('/model with an id outside the catalog before the first message explains instead of pretending', async () => {
  const onSelectProviderModel = vi.fn<SelectProviderModel>(async (_provider, model) => ({ scope: 'default', model }));
  const { view, messages } = renderComposer(null, onSelectProviderModel);

  await submit(view, '/model claude-fable-5-1');

  await waitFor(() => assert.equal(messages.length, 1));
  assert.equal(onSelectProviderModel.mock.calls.length, 0);
  assert.match(String(messages[0].content), /claude-fable-5-1 is not in the model list/);
});

test('an id outside the catalog applies to the session without replacing the new-chat default', async () => {
  localStorage.setItem('claude-model', 'sonnet');
  const { result } = renderHook(() => useChatProviderState({
    selectedSession: { id: 'session-1', __provider: 'claude' },
    selectedProject: PROJECT,
  }));
  await waitFor(() => assert.equal(result.current.currentProviderModelOptions.length, 2));
  await waitFor(() => assert.equal(result.current.currentProviderModel, 'sonnet'));

  await act(async () => {
    await result.current.selectProviderModel('claude', 'claude-fable-5-1', 'session-1');
  });

  assert.equal(result.current.currentProviderModel, 'claude-fable-5-1', 'the session shows and sends the typed id');
  assert.equal(result.current.providerModels.claude, 'sonnet', 'new chats keep the previous default');
  assert.equal(localStorage.getItem('claude-model'), 'sonnet');
});
