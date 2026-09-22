import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  queryClaudeSDK,
  resolveToolApproval,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { rememberClaudeToolPermission } from '@/modules/providers/services/claude-permission-rules.service.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * "Always allow" has to outlive the turn it was granted in. The runtime's
 * in-memory `allowedTools` push cannot do that — the query already read its
 * rules — so the decision is written to the project's
 * `.claude/settings.local.json`, the same file the CLI writes, and read back
 * through `settingSources: ['project', 'user', 'local']` on every later turn.
 */

const LOCAL_SETTINGS = path.join('.claude', 'settings.local.json');

async function withTempProject(run: (projectDirectory: string) => Promise<void>): Promise<void> {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-permission-rules-'));
  try {
    await run(projectDirectory);
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
}

const readSettings = async (projectDirectory: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path.join(projectDirectory, LOCAL_SETTINGS), 'utf8')) as Record<string, unknown>;

test('rememberClaudeToolPermission creates the local settings file with the rule', async () => {
  await withTempProject(async (projectDirectory) => {
    assert.equal(await rememberClaudeToolPermission(projectDirectory, 'Bash(git commit:*)'), true);

    assert.deepEqual(await readSettings(projectDirectory), {
      permissions: { allow: ['Bash(git commit:*)'] },
    });
  });
});

test('rememberClaudeToolPermission appends without disturbing existing keys or rules', async () => {
  await withTempProject(async (projectDirectory) => {
    await mkdir(path.join(projectDirectory, '.claude'), { recursive: true });
    await writeFile(
      path.join(projectDirectory, LOCAL_SETTINGS),
      JSON.stringify({
        model: 'sonnet',
        permissions: { allow: ['Read'], deny: ['Bash(rm:*)'], defaultMode: 'default' },
      }),
      'utf8',
    );

    assert.equal(await rememberClaudeToolPermission(projectDirectory, 'Write'), true);

    assert.deepEqual(await readSettings(projectDirectory), {
      model: 'sonnet',
      permissions: { allow: ['Read', 'Write'], deny: ['Bash(rm:*)'], defaultMode: 'default' },
    });
  });
});

test('rememberClaudeToolPermission does not duplicate a rule the file already has', async () => {
  await withTempProject(async (projectDirectory) => {
    assert.equal(await rememberClaudeToolPermission(projectDirectory, 'Write'), true);
    assert.equal(await rememberClaudeToolPermission(projectDirectory, ' Write '), false);

    assert.deepEqual(await readSettings(projectDirectory), { permissions: { allow: ['Write'] } });
  });
});

test('rememberClaudeToolPermission refuses unusable inputs instead of throwing', async () => {
  await withTempProject(async (projectDirectory) => {
    assert.equal(await rememberClaudeToolPermission(projectDirectory, '   '), false);
    assert.equal(await rememberClaudeToolPermission(projectDirectory, 'Write\nBash'), false);
    assert.equal(await rememberClaudeToolPermission(projectDirectory, 'W'.repeat(513)), false);
    assert.equal(await rememberClaudeToolPermission(undefined, 'Write'), false);
    assert.equal(await rememberClaudeToolPermission('relative/path', 'Write'), false);

    await assert.rejects(readFile(path.join(projectDirectory, LOCAL_SETTINGS), 'utf8'));
  });
});

test('rememberClaudeToolPermission leaves a malformed settings file untouched', async () => {
  await withTempProject(async (projectDirectory) => {
    await mkdir(path.join(projectDirectory, '.claude'), { recursive: true });
    await writeFile(path.join(projectDirectory, LOCAL_SETTINGS), '{ not json', 'utf8');

    assert.equal(await rememberClaudeToolPermission(projectDirectory, 'Write'), false);
    assert.equal(await readFile(path.join(projectDirectory, LOCAL_SETTINGS), 'utf8'), '{ not json');
  });
});

/**
 * Drives the real `canUseTool` the runtime hands the SDK. `context.createQuery`
 * is the seam: it hands back the options the runtime built, so the test can
 * call the permission callback exactly as the SDK would and answer it over the
 * same resolver the websocket transport uses.
 */
test('a remembered approval from canUseTool lands in the project settings file', async () => {
  await withTempProject(async (projectDirectory) => {
    type CanUseTool = (toolName: string, input: unknown, context: unknown) => Promise<unknown>;

    const sent: NormalizedMessage[] = [];
    // Promises rather than mutable locals: the run reaches `createQuery` a few
    // ticks after `queryClaudeSDK` is called, so the test has to wait for the
    // callback rather than read it back synchronously.
    let captureCanUseTool!: (canUseTool: CanUseTool) => void;
    const canUseToolReady = new Promise<CanUseTool>((resolve) => { captureCanUseTool = resolve; });
    let endStream!: () => void;
    const streamEnded = new Promise<void>((resolve) => { endStream = resolve; });

    const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
      captureCanUseTool((options as { canUseTool: CanUseTool }).canUseTool);
      void (async () => { for await (const _message of prompt) { /* the CLI reads its stdin */ } })();

      const iterator = (async function* () {
        await streamEnded;
        // The run exists only to build `canUseTool`; the SDK stream stays empty.
        yield* [];
      })();
      return Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} });
    };

    const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => undefined,
      getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
      normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
      isProviderInstalled: async () => true,
      createQuery,
    };

    const done = queryClaudeSDK(
      'write a file',
      { sessionId: 'app-permission-session', cwd: projectDirectory },
      { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null } as never,
      context,
    );

    const canUseTool = await canUseToolReady;
    const approval = canUseTool(
      'Write',
      { file_path: path.join(projectDirectory, 'note.txt'), content: 'hi' },
      {},
    );

    // The prompt reaches the client before anyone can answer it.
    let request = sent.find((message) => (message as { kind?: string }).kind === 'permission_request');
    while (!request) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
      request = sent.find((message) => (message as { kind?: string }).kind === 'permission_request');
    }

    resolveToolApproval((request as unknown as { requestId: string }).requestId, {
      allow: true,
      rememberEntry: 'Write',
    });

    assert.deepEqual(await approval, {
      behavior: 'allow',
      updatedInput: { file_path: path.join(projectDirectory, 'note.txt'), content: 'hi' },
    });
    assert.deepEqual(await readSettings(projectDirectory), { permissions: { allow: ['Write'] } });

    endStream();
    await done;
  });
});
