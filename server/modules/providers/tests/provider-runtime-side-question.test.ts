import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  claudeRuntime,
  listClaudeSDKBackgroundWork,
  queryClaudeSDK,
  stopClaudeSDKTask,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { createProviderRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import type { IProvider, IProviderRuntime } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  LLMProvider,
  NormalizedMessage,
  ProviderRuntimeContext,
  SideQuestionOutcome,
  SideQuestionRequest,
  SideQuestionSink,
} from '@/shared/types.js';

/**
 * The runtime dispatcher answers a side question either through the
 * provider's own `askSideQuestion` (Claude forks its session) or, for a
 * provider without one, through Claude reading that session's history. The
 * Claude runtime's own method hands the fork the session's live background
 * tasks, looked up by the app session id.
 */

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  released: () => boolean;
  promptMessages: unknown[];
  calls: Array<{ prompt: AsyncIterable<unknown>; options: AnyRecord }>;
  stopped: string[];
};

/** A stand-in for the SDK query: yields what the test emits, and reads the prompt like the CLI reads stdin. */
function createScriptedQuery(): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  const promptMessages: unknown[] = [];
  const calls: Scripted['calls'] = [];
  const stopped: string[] = [];

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    promptMessages,
    calls,
    stopped,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = (input) => {
    calls.push(input);
    void (async () => {
      for await (const message of input.prompt) {
        promptMessages.push(message);
      }
      released = true;
    })();

    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
      }
    })();

    return Object.assign(iterator, {
      interrupt: async () => {},
      stopTask: async (taskId: string) => { stopped.push(taskId); },
    });
  };

  return { createQuery, script };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await settle();
  }
  assert.ok(condition(), 'condition never became true');
}

function promptText(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  const content = (message as { message?: { content?: unknown } })?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''))
      .join('');
  }
  return '';
}

function createRequest(overrides: Partial<SideQuestionRequest> = {}): SideQuestionRequest {
  return {
    appSessionId: 'app-btw-session',
    providerSessionId: 'native-btw-session',
    projectPath: '/tmp/btw-project',
    question: 'Which test covers this?',
    model: 'gpt-5-codex',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function createSink(): { deltas: string[]; sink: SideQuestionSink } {
  const deltas: string[] = [];
  return { deltas, sink: { delta: (text) => { deltas.push(text); } } };
}

function createRuntime(overrides: Partial<IProviderRuntime> = {}): IProviderRuntime {
  return {
    async run() {
      return undefined;
    },
    abort() {
      return false;
    },
    ...overrides,
  };
}

function createProvider(id: LLMProvider, runtime: IProviderRuntime): IProvider {
  return {
    id,
    runtime,
    auth: {
      async getStatus() {
        return { provider: id, installed: true, authenticated: true, method: 'test', details: {} };
      },
    },
    sessions: {
      normalizeMessage(raw: unknown, sessionId: string | null) {
        return [{ kind: 'assistant', content: String(raw), sessionId, provider: id }];
      },
      async fetchHistory() {
        return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
      },
    },
  } as unknown as IProvider;
}

function createService(
  providers: IProvider[],
  overrides: Partial<Parameters<typeof createProviderRuntimeService>[0]> = {},
) {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  return createProviderRuntimeService({
    listProviders: () => providers,
    resolveProvider(providerName) {
      const provider = providerMap.get(providerName as LLMProvider);
      if (!provider) {
        throw new Error(`Missing provider: ${providerName}`);
      }
      return provider;
    },
    resolveProviderSessionId: (sessionId) => (sessionId ? `native-${sessionId}` : null),
    async resolveResumeModel(_provider, _sessionId, requestedModel) {
      return requestedModel?.trim() || undefined;
    },
    async getProviderModels() {
      return { OPTIONS: [], DEFAULT: 'default-model' };
    },
    ...overrides,
  });
}

const historyText = (role: 'user' | 'assistant', content: string, index: number): NormalizedMessage => ({
  id: `h${index}`,
  sessionId: 'app-btw-session',
  timestamp: new Date(1_700_000_000_000 + index * 1000).toISOString(),
  provider: 'codex',
  kind: 'text',
  role,
  content,
});

const assistantText = (text: string) => ({
  type: 'assistant', parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const streamText = (text: string) => ({
  type: 'stream_event', parent_tool_use_id: null,
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});
const success = (text: string) => ({ type: 'result', subtype: 'success', result: text, duration_ms: 1, num_turns: 1 });

test('a provider whose runtime forks natively is asked directly, with the runtime context', { timeout: 5000 }, async () => {
  const { createQuery } = createScriptedQuery();
  const calls: Array<{ request: SideQuestionRequest; sink: SideQuestionSink; context: ProviderRuntimeContext }> = [];
  const native: SideQuestionOutcome = { status: 'done', answer: 'native answer' };
  const provider = createProvider('claude', createRuntime({
    async askSideQuestion(request, sink, context) {
      calls.push({ request, sink, context });
      sink.delta('native answer');
      return native;
    },
  }));
  let historyFetched = false;
  const service = createService([provider], {
    createQuery,
    async fetchSessionHistory() {
      historyFetched = true;
      return [];
    },
  });

  const request = createRequest({ model: 'claude-opus-5' });
  const { deltas, sink } = createSink();
  const outcome = await service.askSideQuestion('claude', request, sink);

  assert.deepEqual(outcome, native);
  assert.equal(calls.length, 1);
  // A copy of the request or a wrapped sink is fine; what it carries and where deltas land is pinned.
  const received = calls[0]!.request;
  assert.deepEqual(
    [received.appSessionId, received.providerSessionId, received.projectPath, received.question, received.model],
    [request.appSessionId, request.providerSessionId, request.projectPath, request.question, request.model],
  );
  assert.ok(received.signal instanceof AbortSignal);
  assert.deepEqual(deltas, ['native answer'], 'a delta sent through the received sink reaches the caller');
  assert.equal(calls[0]!.context.createQuery, createQuery, 'the createQuery override reaches the runtime');
  assert.equal(typeof calls[0]!.context.resolveProviderSessionId, 'function');
  assert.equal(historyFetched, false, 'the native fork needs no history');
});

test('a provider without a native fork is answered by Claude from its history', { timeout: 5000 }, async () => {
  const { createQuery, script } = createScriptedQuery();
  const fetched: string[] = [];
  const provider = createProvider('codex', createRuntime());
  const service = createService([provider], {
    createQuery,
    async fetchSessionHistory(appSessionId) {
      fetched.push(appSessionId);
      return [historyText('user', 'HISTORY-USER-LINE', 1), historyText('assistant', 'HISTORY-ASSISTANT-LINE', 2)];
    },
  });

  const { deltas, sink } = createSink();
  const pending = service.askSideQuestion('codex', createRequest(), sink);
  await waitFor(() => script.calls.length === 1 && script.promptMessages.length >= 1);

  assert.deepEqual(fetched, ['app-btw-session']);
  const { options } = script.calls[0]!;
  assert.equal(options.resume, undefined, 'there is no Claude session to resume');
  assert.equal(options.forkSession, undefined);
  assert.equal(options.model, undefined, "the request's codex model is not sent to Claude");
  const text = script.promptMessages.map(promptText).join('\n');
  assert.ok(text.includes('HISTORY-USER-LINE') && text.includes('HISTORY-ASSISTANT-LINE'));
  assert.ok(text.includes('Which test covers this?'));

  script.emit(streamText('See the history.'));
  script.emit(assistantText('See the history.'));
  script.emit(success('See the history.'));

  assert.deepEqual(await pending, { status: 'done', answer: 'See the history.' });
  assert.deepEqual(deltas, ['See the history.']);
});

test('a failing history fetch is an error outcome, not a rejection', { timeout: 5000 }, async () => {
  const { createQuery, script } = createScriptedQuery();
  const service = createService([createProvider('codex', createRuntime())], {
    createQuery,
    async fetchSessionHistory() {
      throw new Error('history unavailable');
    },
  });

  const { sink } = createSink();
  const outcome = await service.askSideQuestion('codex', createRequest(), sink);

  assert.equal(outcome.status, 'error');
  assert.equal(script.calls.length, 0, 'no query is started without a history');
});

test('an unknown provider is an error outcome, not a rejection', { timeout: 5000 }, async () => {
  const { createQuery, script } = createScriptedQuery();
  const service = createService([createProvider('codex', createRuntime())], {
    createQuery,
    async fetchSessionHistory() {
      return [];
    },
  });

  const outcome = await service.askSideQuestion('nope' as LLMProvider, createRequest(), createSink().sink);

  assert.equal(outcome.status, 'error');
  assert.equal(script.calls.length, 0);
});

test('a native askSideQuestion that throws is an error outcome, not a rejection', { timeout: 5000 }, async () => {
  const provider = createProvider('claude', createRuntime({
    async askSideQuestion() {
      throw new Error('runtime blew up');
    },
  }));
  const service = createService([provider], {
    async fetchSessionHistory() {
      return [];
    },
  });

  const outcome = await service.askSideQuestion('claude', createRequest(), createSink().sink);

  assert.equal(outcome.status, 'error');
});

test('claudeRuntime.askSideQuestion forks with the live tasks of that app session', { timeout: 10000 }, async () => {
  assert.equal(typeof claudeRuntime.askSideQuestion, 'function');

  const SESSION_ID = 'app-btw-held-session';
  const NATIVE_ID = 'native-btw-held-session';
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-side-question-'));
  const held = createScriptedQuery();
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const baseContext: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };
  const writer = { send: () => {}, userId: null };

  try {
    // A turn that leaves one workflow running, so the tracker holds it for SESSION_ID.
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, { ...baseContext, createQuery: held.createQuery });
    held.script.emit({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
    held.script.emit({
      type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_wf', name: 'Workflow', input: { script: 'export const meta = {}' } }] },
    });
    held.script.emit({
      type: 'system', subtype: 'task_started', session_id: NATIVE_ID, task_id: 'wf1', tool_use_id: 'toolu_wf', description: 'Held workflow wf1', task_type: 'local_workflow',
    });
    held.script.emit({
      type: 'user', session_id: NATIVE_ID, parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_wf', content: 'Workflow launched in background. Task ID: wf1' }] },
      tool_use_result: { status: 'async_launched', taskId: 'wf1', taskType: 'local_workflow' },
    });
    held.script.emit({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'launched', duration_ms: 1, num_turns: 1 });
    await waitFor(() => listClaudeSDKBackgroundWork().some((entry) => entry.sessionId === SESSION_ID));

    // The session's own side question sees the workflow.
    const own = createScriptedQuery();
    const ownPending = claudeRuntime.askSideQuestion(
      createRequest({ appSessionId: SESSION_ID, providerSessionId: NATIVE_ID, projectPath: cwd, model: null }),
      createSink().sink,
      { ...baseContext, createQuery: own.createQuery },
    );
    await waitFor(() => own.script.promptMessages.length >= 1);
    assert.equal(own.script.calls[0]!.options.resume, NATIVE_ID);
    assert.ok(promptText(own.script.promptMessages[0]).includes('Held workflow wf1'), 'the live task is in the fork prompt');
    own.script.emit(assistantText('ok'));
    own.script.emit(success('ok'));
    assert.equal((await ownPending).status, 'done');

    // Another session's side question does not.
    const other = createScriptedQuery();
    const otherPending = claudeRuntime.askSideQuestion(
      createRequest({ appSessionId: 'app-some-other-session', providerSessionId: 'native-other', projectPath: cwd, model: null }),
      createSink().sink,
      { ...baseContext, createQuery: other.createQuery },
    );
    await waitFor(() => other.script.promptMessages.length >= 1);
    assert.equal(promptText(other.script.promptMessages[0]).includes('Held workflow wf1'), false, 'tasks are looked up by app session id');
    other.script.emit(assistantText('ok'));
    other.script.emit(success('ok'));
    await otherPending;

    // Let the held run go.
    assert.equal(await stopClaudeSDKTask(SESSION_ID, 'wf1'), true);
    held.script.emit({
      type: 'system', subtype: 'task_notification', session_id: NATIVE_ID, task_id: 'wf1', tool_use_id: 'toolu_wf', status: 'stopped', summary: 'stopped', output_file: '',
    });
    await waitFor(() => held.script.released());
    held.script.end();
    await done;
  } finally {
    // A failed assertion above must not leave the held run alive.
    held.script.end();
    await rm(cwd, { recursive: true, force: true });
  }
});
