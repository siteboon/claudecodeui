import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ElicitationRequest, ElicitationResult } from '@anthropic-ai/claude-agent-sdk';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  getPendingApprovalsForSession,
  queryClaudeSDK,
  resolveToolApproval,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * An MCP server can ask the person for input in the middle of a tool call. The
 * SDK hands that to `onElicitation`, and answers `decline` by itself when no
 * callback is set, which tells the server a person refused when nobody was
 * asked. These capture the options `queryClaudeSDK` passes to the SDK, call the
 * callback as the SDK would, and answer through the same resolver the
 * `chat.permission-response` message reaches.
 */

const SESSION_ID = 'app-elicitation-session';

type OnElicitation = (request: ElicitationRequest, options: { signal: AbortSignal; requestId: string }) => Promise<ElicitationResult>;

async function withRun(
  runTest: (context: { onElicitation: OnElicitation; sent: NormalizedMessage[] }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-elicitation-'));
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  let captured: OnElicitation | null = null;
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => { finish = resolve; });

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ options }) => {
    captured = (options as { onElicitation?: OnElicitation }).onElicitation ?? null;
    // Holds the run open until the test is done, and yields nothing: only the
    // options passed in matter here.
    const iterator = (async function* () {
      await finished;
      yield* [] as Record<string, unknown>[];
    })();
    return Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} });
  };

  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, context);
    for (let attempt = 0; attempt < 200 && !captured; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    assert.ok(captured, 'queryClaudeSDK passed no onElicitation to the SDK');
    await runTest({ onElicitation: captured, sent });
    finish();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const form: ElicitationRequest = {
  serverName: 'vault',
  message: 'Which target should this write to?',
  mode: 'form',
  requestedSchema: {
    type: 'object',
    properties: { target: { type: 'string', enum: ['prod', 'dev'] }, count: { type: 'integer' } },
    required: ['target'],
  },
};

/** Calls the callback, waits for its permission request, answers it, and returns both. */
async function ask(
  onElicitation: OnElicitation,
  sent: NormalizedMessage[],
  request: ElicitationRequest,
  decision: Record<string, unknown> | null,
) {
  const controller = new AbortController();
  const pending = onElicitation(request, { signal: controller.signal, requestId: 'ctl-1' });
  const permission = sent.find((message) => message.kind === 'permission_request' && !sent.some(
    (other) => other.kind === 'permission_resolved' && other.requestId === message.requestId,
  ));
  assert.ok(permission, 'no permission_request was sent');
  const requestId = permission.requestId as string;
  if (decision) {
    resolveToolApproval(requestId, decision);
  } else {
    controller.abort();
  }
  return { result: await pending, permission, requestId };
}

test('an elicitation is sent to the client as an McpElicitation request carrying the form', async () => {
  await withRun(async ({ onElicitation, sent }) => {
    const pending = onElicitation(form, { signal: new AbortController().signal, requestId: 'ctl-1' });
    const permission = sent.find((message) => message.kind === 'permission_request');
    assert.ok(permission, 'no permission_request was sent');
    assert.equal(permission.toolName, 'McpElicitation');
    const input = permission.input as Record<string, unknown>;
    assert.deepEqual(input.requestedSchema, form.requestedSchema);
    assert.equal(input.message, form.message);

    // Listed as pending, so a reconnecting tab replays the form.
    const listed = getPendingApprovalsForSession(SESSION_ID);
    assert.equal(listed.some((entry) => entry.toolName === 'McpElicitation'), true);

    resolveToolApproval(permission.requestId as string, { allow: false });
    await pending;
  });
});

test('a submitted form is accept with its content, and the prompt is retracted', async () => {
  await withRun(async ({ onElicitation, sent }) => {
    const { result, requestId } = await ask(onElicitation, sent, form, {
      allow: true,
      updatedInput: { content: { target: 'dev', count: 3, stray: { nested: true } } },
    });
    // Only flat values survive: a form field is never an object.
    assert.deepEqual(result, { action: 'accept', content: { target: 'dev', count: 3 } });
    assert.equal(sent.some((message) => message.kind === 'permission_resolved' && message.requestId === requestId), true);
  });
});

test('Decline is decline', async () => {
  await withRun(async ({ onElicitation, sent }) => {
    const { result } = await ask(onElicitation, sent, form, { allow: false });
    assert.deepEqual(result, { action: 'decline' });
  });
});

test('an abort is cancel, never an accept or a decline', async () => {
  await withRun(async ({ onElicitation, sent }) => {
    const { result, requestId } = await ask(onElicitation, sent, form, null);
    assert.deepEqual(result, { action: 'cancel' });
    assert.equal(sent.some((message) => message.kind === 'permission_cancelled' && message.requestId === requestId), true);
    assert.equal(sent.some((message) => message.kind === 'permission_resolved' && message.requestId === requestId), false);
  });
});

test('a URL request is accepted without content', async () => {
  await withRun(async ({ onElicitation, sent }) => {
    const { result, permission } = await ask(onElicitation, sent, {
      serverName: 'auth',
      message: 'Sign in to continue.',
      mode: 'url',
      url: 'https://example.test/login',
      elicitationId: 'e1',
    }, { allow: true, updatedInput: {} });
    assert.equal((permission.input as Record<string, unknown>).url, 'https://example.test/login');
    assert.deepEqual(result, { action: 'accept' });
  });
});

test('an unattended run sets no callback, so the SDK declines at once instead of waiting on nobody', async () => {
  const startedWith = async (runOptions: Record<string, unknown>) => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-elicitation-'));
    const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
    let passed: Record<string, unknown> | null = null;
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => undefined,
      getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
      normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
      isProviderInstalled: async () => true,
      createQuery: ({ options }) => {
        passed = options as Record<string, unknown>;
        return Object.assign((async function* () {
          yield* [] as Record<string, unknown>[];
        })(), { interrupt: async () => {}, stopTask: async () => {} });
      },
    };
    try {
      const writer = { send: () => {}, userId: null };
      await queryClaudeSDK('hello', { sessionId: `${SESSION_ID}-${String(runOptions.unattended)}`, cwd, ...runOptions }, writer as never, context);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
    assert.ok(passed, 'queryClaudeSDK did not start the SDK');
    return passed as Record<string, unknown>;
  };

  assert.equal((await startedWith({ unattended: true })).onElicitation, undefined);
  assert.equal(typeof (await startedWith({})).onElicitation, 'function');
  // What an attended agent-API run passes: the form must survive bypass mode.
  const attendedBypass = await startedWith({ unattended: false, permissionMode: 'bypassPermissions' });
  assert.equal(attendedBypass.permissionMode, 'bypassPermissions');
  assert.equal(typeof attendedBypass.onElicitation, 'function');
});
