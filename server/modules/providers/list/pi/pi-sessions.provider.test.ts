import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { PiPaths } from './pi-paths.provider.js';
import { PiSessionsProvider } from './pi-sessions.provider.js';

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-sessions-'));

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

let counter = 0;
function writeSession(
  lines: string[],
  { trailingNewline = true } = {},
): { sessionId: string; filePath: string; provider: PiSessionsProvider } {
  const sessionId = `session-${counter++}`;
  const root = path.join(tmpRoot, sessionId);
  const file = path.join(root, `${sessionId}.jsonl`);
  mkdirSync(root, { recursive: true });
  const body = lines.join('\n') + (trailingNewline ? '\n' : '');
  writeFileSync(file, body, 'utf8');

  process.env.PI_CODING_AGENT_SESSION_DIR = root;
  const provider = new PiSessionsProvider(new PiPaths());
  return { sessionId, filePath: file, provider };
}

function header(): string {
  return JSON.stringify({
    type: 'session',
    version: 3,
    id: '00000000-0000-4000-8000-000000000000',
    timestamp: '2026-08-03T00:00:00.000Z',
    cwd: '/tmp/fake-workspace',
  });
}

function userEntry(id: string, parentId: string | null): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-08-03T00:00:00.000Z',
    message: { role: 'user', content: 'hello', timestamp: '2026-08-03T00:00:00.000Z' },
  });
}

function assistantEntry(id: string, parentId: string): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-08-03T00:00:01.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'hi there' }],
      model: 'model-a',
      provider: 'anthropic',
      stopReason: 'stop',
      timestamp: '2026-08-03T00:00:01.000Z',
    },
  });
}

function assistantThinkingEntry(id: string, parentId: string): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-08-03T00:00:01.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'considering the request', thinkingSignature: 'private-signature' },
        { type: 'text', text: 'final answer' },
      ],
      model: 'model-a',
      provider: 'anthropic',
      stopReason: 'stop',
      timestamp: 1785722401000,
    },
  });
}

function modelChangeEntry(id: string, parentId: string, provider: string, modelId: string): string {
  return JSON.stringify({
    type: 'model_change',
    id,
    parentId,
    timestamp: '2026-08-03T00:00:02.000Z',
    provider,
    modelId,
  });
}

// T14 有效 v3 session -> active branch 归一化 history
test('T14 有效 v3 session 归一化 active branch history', async () => {
  const { sessionId, provider } = writeSession([
    header(),
    userEntry('u1', null),
    assistantEntry('a1', 'u1'),
  ]);

  const result = await provider.fetchHistory(sessionId);

  assert.equal(result.messages.length, 2);
  assert.equal(result.total, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].id, 'u1:0');
  assert.equal(result.messages[0].content, 'hello');
  assert.equal(result.messages[1].role, 'assistant');
  assert.equal(result.messages[1].id, 'a1:0');
  assert.equal(result.messages[1].content, 'hi there');
  assert.equal(result.messages[0].provider, 'pi');
});

test('uses the indexed transcript path when Pi nests sessions below its root', async () => {
  const { filePath, provider } = writeSession([
    header(),
    userEntry('u1', null),
    assistantEntry('a1', 'u1'),
  ]);

  const result = await provider.fetchHistory('app-session', {
    providerSessionId: 'native-session-not-at-the-root',
    sessionFilePath: filePath,
  });

  assert.equal(result.total, 2);
  assert.equal(result.messages[0].sessionId, 'app-session');
  assert.equal(result.messages[1].content, 'hi there');
});

test('preserves Pi thinking blocks and normalizes numeric message timestamps', async () => {
  const { sessionId, provider } = writeSession([
    header(),
    userEntry('u1', null),
    assistantThinkingEntry('a1', 'u1'),
  ]);

  const result = await provider.fetchHistory(sessionId);

  assert.equal(result.messages.length, 3);
  assert.deepEqual(
    result.messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      content: message.content,
      timestamp: message.timestamp,
    })),
    [
      {
        id: 'u1:0',
        kind: 'text',
        content: 'hello',
        timestamp: '2026-08-03T00:00:00.000Z',
      },
      {
        id: 'a1:0',
        kind: 'thinking',
        content: 'considering the request',
        timestamp: '2026-08-03T02:00:01.000Z',
      },
      {
        id: 'a1:1',
        kind: 'text',
        content: 'final answer',
        timestamp: '2026-08-03T02:00:01.000Z',
      },
    ],
  );
  assert.equal('thinkingSignature' in result.messages[1], false);
});

// T15 尾部半行 -> 忽略半行返回其余
test('T15 尾部半行被忽略并返回其余历史', async () => {
  const { sessionId, provider } = writeSession(
    [
      header(),
      userEntry('u1', null),
      assistantEntry('a1', 'u1'),
      '{"type":"message","id":"a2"',
    ],
    { trailingNewline: false },
  );

  const result = await provider.fetchHistory(sessionId);

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].id, 'u1:0');
  assert.equal(result.messages[1].id, 'a1:0');
});

// T21 active branch 最后 model_change -> 当前模型
test('T21 active branch 最后 model_change 作为当前模型透传', async () => {
  const { sessionId, provider } = writeSession([
    header(),
    userEntry('u1', null),
    assistantEntry('a1', 'u1'),
    modelChangeEntry('m1', 'a1', 'openai', 'gpt-x'),
  ]);

  const result = await provider.fetchHistory(sessionId);

  assert.deepEqual(result.currentModel, { provider: 'openai', modelId: 'gpt-x' });
});
