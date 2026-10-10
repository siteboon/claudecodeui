import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK, resolveToolApproval } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * AskUserQuestion and ExitPlanMode need the owner's answer. In 'auto' and
 * 'bypassPermissions' the CLI never calls `canUseTool`, so the runtime routes
 * them through a PreToolUse hook, which runs before permission-mode handling.
 */

type HookCallback = (input: Record<string, unknown>, toolUseId: string | undefined, options: { signal: AbortSignal }) => Promise<Record<string, any>>;
type CapturedOptions = {
  hooks?: { PreToolUse?: Array<{ matcher: string; hooks: HookCallback[] }> };
  disallowedTools?: string[];
  permissionMode?: string;
};

/**
 * Starts a turn whose scripted SDK stream stays open until `finish` is called,
 * and returns the options every `createQuery` attempt received.
 */
async function startTurn(permissionMode: string, { rejectHooks = false } = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-interaction-hook-'));
  const sent: NormalizedMessage[] = [];
  const attempts: CapturedOptions[] = [];
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });

  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
    createQuery: ({ prompt, options }) => {
      attempts.push(options as CapturedOptions);
      if (rejectHooks && options.hooks) {
        throw new Error('hooks not supported');
      }
      void (async () => { for await (const _message of prompt) { /* read */ } })();
      const stream = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'native-hook-session' };
        await finished;
        yield { type: 'result', subtype: 'success', session_id: 'native-hook-session', result: 'ok', duration_ms: 1, num_turns: 1 };
      })();
      return Object.assign(stream, { interrupt: async () => {} });
    },
  };

  const run = queryClaudeSDK('hello', { sessionId: `app-hook-${Math.random()}`, cwd, permissionMode }, { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null } as never, context);
  for (let attempt = 0; attempt < 200 && attempts.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return {
    sent,
    attempts,
    async end() {
      finish();
      await run;
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

const preToolUseHook = (options: CapturedOptions) => {
  const entry = options.hooks?.PreToolUse?.[0];
  assert.ok(entry, 'a PreToolUse hook is registered');
  return entry;
};

for (const mode of ['bypassPermissions', 'auto', 'default']) {
  test(`AskUserQuestion is answered by the owner through the hook in ${mode} mode`, async () => {
    const turn = await startTurn(mode);
    try {
      const entry = preToolUseHook(turn.attempts[0]);
      assert.equal(entry.matcher, 'AskUserQuestion|ExitPlanMode');

      const question = { questions: [{ question: 'Which database?', options: [{ label: 'SQLite' }, { label: 'Postgres' }] }] };
      const pending = entry.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: question }, 'toolu_1', { signal: new AbortController().signal });

      const request = turn.sent.find((message) => message.kind === 'permission_request');
      assert.ok(request?.requestId, 'the owner is asked');
      assert.equal(request.toolName, 'AskUserQuestion');

      const answered = { ...question, answers: { 'Which database?': 'Postgres' } };
      resolveToolApproval(request.requestId, { allow: true, updatedInput: answered });
      assert.deepEqual(await pending, {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: answered },
      });
    } finally {
      await turn.end();
    }
  });
}

test('a denied ExitPlanMode is denied by the hook with the owner\'s reason', async () => {
  const turn = await startTurn('bypassPermissions');
  try {
    const entry = preToolUseHook(turn.attempts[0]);
    const pending = entry.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: 'Do it' } }, 'toolu_2', { signal: new AbortController().signal });
    const request = turn.sent.find((message) => message.kind === 'permission_request');
    assert.ok(request?.requestId);
    resolveToolApproval(request.requestId, { allow: false, message: 'Keep planning' });
    assert.deepEqual(await pending, {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Keep planning' },
    });
  } finally {
    await turn.end();
  }
});

test('the hook leaves other tools to the normal permission flow', async () => {
  const turn = await startTurn('bypassPermissions');
  try {
    const entry = preToolUseHook(turn.attempts[0]);
    const output = await entry.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, 'toolu_3', { signal: new AbortController().signal });
    assert.deepEqual(output, {});
    assert.equal(turn.sent.some((message) => message.kind === 'permission_request'), false);
  } finally {
    await turn.end();
  }
});

test('without hook support, modes that skip canUseTool disallow interaction-required tools', async () => {
  const turn = await startTurn('bypassPermissions', { rejectHooks: true });
  try {
    assert.equal(turn.attempts.length, 2);
    const retry = turn.attempts[1];
    assert.equal(retry.hooks, undefined);
    assert.ok(retry.disallowedTools?.includes('AskUserQuestion'));
    assert.ok(retry.disallowedTools?.includes('ExitPlanMode'));
  } finally {
    await turn.end();
  }
});

test('without hook support, default mode keeps asking through canUseTool', async () => {
  const turn = await startTurn('default', { rejectHooks: true });
  try {
    const retry = turn.attempts[1];
    assert.equal(retry.disallowedTools?.includes('AskUserQuestion') ?? false, false);
  } finally {
    await turn.end();
  }
});
