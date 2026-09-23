import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import express from 'express';

import { createGitRouter } from '@/modules/git/git.routes.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

type GitDependencies = Parameters<typeof createGitRouter>[0];
type RunFunction = GitDependencies['queryClaude'];

/**
 * `POST /api/git/generate-commit-message` runs a provider headlessly and
 * reads its answer off the writer. The reader only knew the pre-unification
 * `claude-response` / `cursor-output` shapes, so it never found the reply in
 * the normalized events the runtimes send and always answered the
 * `chore: update files` fallback. The fallback is still the answer when the
 * reply holds no commit message, such as a failure the CLI words as a reply.
 */

/** A git stand-in for one repository at /workspace/repo with a modified a.txt. */
const spawnProcess = ((_command: string, args: string[]) => {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  process.nextTick(() => {
    if (args.includes('--is-inside-work-tree')) child.stdout.write('true\n');
    if (args.includes('--show-toplevel')) child.stdout.write('/workspace/repo\n');
    if (args[0] === 'status') child.stdout.write(' M a.txt\n');
    if (args[0] === 'diff') child.stdout.write('diff --git a/a.txt b/a.txt\n@@ -1 +1,2 @@\n line1\n+line2\n');
    child.stdout.end();
    child.stderr.end();
    child.emit('close', 0);
  });
  return child;
}) as GitDependencies['spawnProcess'];

async function generateCommitMessage(providers: { queryClaude?: RunFunction; queryCursor?: RunFunction }, provider: string): Promise<string> {
  const unexpectedProvider = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  const router = createGitRouter({
    fileSystem: { access: async () => undefined } as unknown as GitDependencies['fileSystem'],
    spawnProcess,
    resolveProjectPathById: () => '/workspace/repo',
    queryClaude: providers.queryClaude ?? unexpectedProvider,
    queryCursor: providers.queryCursor ?? unexpectedProvider,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/git', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/git/generate-commit-message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'project-1', files: ['a.txt'], provider }),
    });
    assert.equal(response.status, 200);
    return ((await response.json()) as { message: string }).message;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('a Claude run\'s reply becomes the generated commit message', async () => {
  const message = await generateCommitMessage({
    // The events the Claude runtime sends for a one-message answer.
    queryClaude: async (_command, _options, writer) => {
      writer.send(createNormalizedMessage({ kind: 'session_created', newSessionId: 'native-1', sessionId: 'native-1', provider: 'claude' }));
      writer.send(createNormalizedMessage({ kind: 'thinking', content: 'Looking at the diff.', sessionId: 'native-1', provider: 'claude' }));
      writer.send(createNormalizedMessage({ kind: 'text', role: 'assistant', content: 'feat(a): add line2\n\nAppend a second line to a.txt.', sessionId: 'native-1', provider: 'claude' }));
      writer.send(createNormalizedMessage({
        kind: 'status', text: 'token_budget', sessionId: 'native-1', provider: 'claude',
        tokenBudget: { used: 120, total: 160_000, inputTokens: 100, outputTokens: 20, breakdown: { input: 100, output: 20 } },
      }));
      writer.send(createCompleteMessage({ provider: 'claude', sessionId: 'native-1', exitCode: 0 }));
    },
  }, 'claude');

  assert.equal(message, 'feat(a): add line2\n\nAppend a second line to a.txt.');
});

test('a Cursor run\'s streamed chunks become the generated commit message', async () => {
  const message = await generateCommitMessage({
    // Cursor's prose arrives only as `stream_delta` chunks.
    queryCursor: async (_command, _options, writer) => {
      writer.send(createNormalizedMessage({ kind: 'stream_delta', content: 'fix(a): add line2', sessionId: 'cursor-1', provider: 'cursor' }));
      writer.send(createNormalizedMessage({ kind: 'stream_delta', content: '\n\nAppend a second line.', sessionId: 'cursor-1', provider: 'cursor' }));
      writer.send(createCompleteMessage({ provider: 'cursor', sessionId: 'cursor-1', exitCode: 0 }));
    },
  }, 'cursor');

  assert.equal(message, 'fix(a): add line2\n\nAppend a second line.');
});

test('a Claude failure delivered as reply text falls back instead of becoming the commit message', async () => {
  const message = await generateCommitMessage({
    // What the Claude runtime sends when the CLI is not logged in: the CLI's
    // synthetic assistant message normalizes to an ordinary `text` row, and
    // its `result` (is_error: true) still completes with exit code 0.
    queryClaude: async (_command, _options, writer) => {
      writer.send(createNormalizedMessage({ kind: 'text', role: 'assistant', content: 'Not logged in · Please run /login', sessionId: 'native-1', provider: 'claude' }));
      writer.send(createCompleteMessage({ provider: 'claude', sessionId: 'native-1', exitCode: 0 }));
    },
  }, 'claude');

  assert.equal(message, 'chore: update files');
});

test('explanatory text ahead of the commit message is dropped', async () => {
  const message = await generateCommitMessage({
    queryClaude: async (_command, _options, writer) => {
      writer.send(createNormalizedMessage({ kind: 'text', role: 'assistant', content: 'Here is the commit message:\n\nfeat(a): add line2', sessionId: 'native-1', provider: 'claude' }));
      writer.send(createCompleteMessage({ provider: 'claude', sessionId: 'native-1', exitCode: 0 }));
    },
  }, 'claude');

  assert.equal(message, 'feat(a): add line2');
});

test('a breaking-change commit message is kept', async () => {
  const message = await generateCommitMessage({
    queryClaude: async (_command, _options, writer) => {
      writer.send(createNormalizedMessage({ kind: 'text', role: 'assistant', content: 'feat(api)!: drop the v1 endpoints\n\nBREAKING CHANGE: v1 clients must move to v2.', sessionId: 'native-1', provider: 'claude' }));
      writer.send(createCompleteMessage({ provider: 'claude', sessionId: 'native-1', exitCode: 0 }));
    },
  }, 'claude');

  assert.equal(message, 'feat(api)!: drop the v1 endpoints\n\nBREAKING CHANGE: v1 clients must move to v2.');
});
