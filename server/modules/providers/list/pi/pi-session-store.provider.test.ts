import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { PiSessionStore } from './pi-session-store.provider.js';

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-session-store-'));

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

let counter = 0;
function writeJsonl(lines: string[], { trailingNewline = true } = {}): string {
  const file = path.join(tmpRoot, `session-${counter++}.jsonl`);
  const body = lines.join('\n') + (trailingNewline ? '\n' : '');
  writeFileSync(file, body, 'utf8');
  return file;
}

const NO_VERSION = Symbol('no-version');
function header(version: number | typeof NO_VERSION = 3): string {
  const h: Record<string, unknown> = {
    type: 'session',
    id: '00000000-0000-4000-8000-000000000000',
    timestamp: '2026-08-03T00:00:00.000Z',
    cwd: '/tmp/fake-workspace',
  };
  if (version !== NO_VERSION) h.version = version;
  return JSON.stringify(h);
}

function completeUsage(overrides: Record<string, unknown> = {}) {
  return {
    input: 10,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 30,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  };
}

function assistantEntry(
  id: string,
  parentId: string | null,
  opts: { stopReason?: string; usage?: unknown; text?: string } = {},
): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-08-03T00:00:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: opts.text ?? 'hi' }],
      model: 'model-a',
      provider: 'anthropic',
      stopReason: opts.stopReason ?? 'stop',
      usage: 'usage' in opts ? opts.usage : completeUsage(),
    },
  });
}

function userEntry(id: string, parentId: string | null): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-08-03T00:00:00.000Z',
    message: { role: 'user', content: 'hello', timestamp: 0 },
  });
}

// T14
test('T14 有效 v3 header 归一化 active branch history', () => {
  const file = writeJsonl([
    header(3),
    userEntry('u1', null),
    assistantEntry('a1', 'u1'),
  ]);
  const snap = PiSessionStore.load(file);
  assert.equal(snap.header.version, 3);
  assert.equal(snap.header.cwd, '/tmp/fake-workspace');
  assert.deepEqual(snap.entries.map((e) => e.id), ['u1', 'a1']);
  assert.equal(snap.messages.length, 2);
  assert.equal(snap.messages[0].role, 'user');
});

// T15
test('T15 尾部半行忽略，返回其余', () => {
  const good = [header(3), userEntry('u1', null), assistantEntry('a1', 'u1')];
  const file = writeJsonl([...good, '{"type":"message","id":"a2"'], {
    trailingNewline: false,
  });
  const snap = PiSessionStore.load(file);
  assert.deepEqual(snap.entries.map((e) => e.id), ['u1', 'a1']);
});

// T16
test('T16 中间损坏行抛 ERR-PI-SESSION-CORRUPT 含行号', () => {
  const file = writeJsonl([
    header(3),
    userEntry('u1', null),
    '{ broken json here',
    assistantEntry('a1', 'u1'),
  ]);
  assert.throws(
    () => PiSessionStore.load(file),
    (err: unknown) => {
      const e = err as { code?: string; message: string };
      return e.code === 'PI_SESSION_CORRUPT' && /3/.test(e.message);
    },
  );
});

// T17
test('T17 不支持版本抛 ERR-PI-SESSION-VERSION-UNSUPPORTED', () => {
  const file = writeJsonl([header(2), userEntry('u1', null)]);
  assert.throws(
    () => PiSessionStore.load(file),
    (err: unknown) => (err as { code?: string }).code === 'PI_SESSION_VERSION_UNSUPPORTED',
  );

  const fileNoVersion = writeJsonl([header(NO_VERSION), userEntry('u1', null)]);
  assert.throws(
    () => PiSessionStore.load(fileNoVersion),
    (err: unknown) => (err as { code?: string }).code === 'PI_SESSION_VERSION_UNSUPPORTED',
  );
});

// T21
test('T21 active branch 最后 model_change 决定当前模型', () => {
  const modelChange = (id: string, parentId: string, modelId: string) =>
    JSON.stringify({
      type: 'model_change',
      id,
      parentId,
      timestamp: '2026-08-03T00:00:00.000Z',
      provider: 'anthropic',
      modelId,
    });
  const file = writeJsonl([
    header(3),
    userEntry('u1', null),
    modelChange('m1', 'u1', 'model-old'),
    assistantEntry('a1', 'm1'),
    modelChange('m2', 'a1', 'model-new'),
  ]);
  const snap = PiSessionStore.load(file);
  assert.deepEqual(snap.currentModel, { provider: 'anthropic', modelId: 'model-new' });
});

// T22
test('T22 最后一个非 error/未中止且 usage 完整返回该 usage', () => {
  const file = writeJsonl([
    header(3),
    userEntry('u1', null),
    assistantEntry('a1', 'u1', { usage: completeUsage({ totalTokens: 111 }) }),
    userEntry('u2', 'a1'),
    assistantEntry('a2', 'u2', { stopReason: 'error', usage: completeUsage({ totalTokens: 999 }) }),
  ]);
  const snap = PiSessionStore.load(file);
  assert.ok(snap.lastUsage);
  assert.equal(snap.lastUsage?.totalTokens, 111);
});

// T23
test('T23 无满足条件 usage 返回无 usage', () => {
  const file = writeJsonl([
    header(3),
    userEntry('u1', null),
    assistantEntry('a1', 'u1', { stopReason: 'aborted' }),
    assistantEntry('a2', 'a1', { stopReason: 'error' }),
  ]);
  const snap = PiSessionStore.load(file);
  assert.equal(snap.lastUsage, null);
});

// 不可变性
test('快照为不可变', () => {
  const file = writeJsonl([header(3), userEntry('u1', null)]);
  const snap = PiSessionStore.load(file);
  assert.ok(Object.isFrozen(snap));
  assert.ok(Object.isFrozen(snap.entries));
});
