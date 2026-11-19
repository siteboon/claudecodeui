import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

const SESSION_ID = 'recovery-session';
const EXPECTED_MAPPING = { provider: 'codex', providerSessionId: 'captured-thread' };

async function fixture(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chat-recovery-send-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  t.after(async () => {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  });
  sessionsDb.createAppSession(SESSION_ID, 'codex', directory);
  sessionsDb.assignProviderSessionId(SESSION_ID, EXPECTED_MAPPING.providerSessionId);

  const frames: Array<Record<string, unknown>> = [];
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: (raw: string) => { frames.push(JSON.parse(raw)); },
  });
  const runs: Array<{ command: string; nativeId: string | null | undefined }> = [];
  const runtime: ProviderRuntimeGateway = {
    hasRuntime: () => true,
    run: async (_provider, command) => {
      runs.push({ command, nativeId: sessionsDb.getSessionById(SESSION_ID)?.provider_session_id });
    },
    abort: async () => false,
    stopBackgroundTask: async () => false,
    hasBackgroundWork: () => false,
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    askSideQuestion: async () => { throw new Error('Recovery must not start a side question.'); },
    steer: async () => false,
  };
  handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime });
  return {
    frames, runs, runtime,
    send: (data: Record<string, unknown> = {}) => socket.emit('message', JSON.stringify({
      type: 'chat.recover', sessionId: SESSION_ID, content: 'continue',
      expectedProviderMapping: EXPECTED_MAPPING, ...data,
    })),
  };
}

// The message listener dispatches asynchronously; drain it before inspecting runs.
const settle = () => new Promise<void>((resolve) => { setImmediate(resolve); });

test('recovery admits the captured mapping and ordinary sends remain compatible', async (t) => {
  const f = await fixture(t);
  f.send();
  await settle();
  assert.deepEqual(f.runs, [{ command: 'continue', nativeId: 'captured-thread' }]);
  f.send({ type: 'chat.send', expectedProviderMapping: undefined, content: 'ordinary turn' });
  await settle();
  assert.equal(f.runs[1]?.command, 'ordinary turn');
});

test('recovery rejects a native mapping changed while an earlier session was processing', async (t) => {
  const f = await fixture(t);
  // Snapshot preflight has already passed. An edit of this later pending
  // session forks it while recovery is still confirming an earlier session.
  sessionsDb.repointSessionToProviderSession(SESSION_ID, {
    providerSessionId: 'edited-thread', jsonlPath: '/unused/edited.jsonl',
  });
  f.send({ options: { model: 'must-not-be-saved' } });
  await settle();
  assert.equal(f.frames.at(-1)?.code, 'RECOVERY_MAPPING_CHANGED');
  assert.equal(f.runs.length, 0);
  assert.equal(chatRunRegistry.getRun(SESSION_ID), undefined);
  assert.equal(sessionsDb.getSessionById(SESSION_ID)?.model, null);
});

test('recovery checks the provider as well as the native id', async (t) => {
  const f = await fixture(t);
  f.send({ expectedProviderMapping: { ...EXPECTED_MAPPING, provider: 'claude' } });
  await settle();
  assert.equal(f.frames.at(-1)?.code, 'RECOVERY_MAPPING_CHANGED');
  assert.equal(f.runs.length, 0);
});

test('recovery rejects a session detached by editing the first turn', async (t) => {
  const f = await fixture(t);
  sessionsDb.detachProviderSession(SESSION_ID);
  f.send();
  await settle();
  assert.equal(f.frames.at(-1)?.code, 'RECOVERY_MAPPING_CHANGED');
  assert.equal(f.runs.length, 0);
});

test('recovery requires a complete captured provider mapping', async (t) => {
  const f = await fixture(t);
  for (const expectedProviderMapping of [undefined, null, [], 'thread', {},
    { provider: 'codex' }, { ...EXPECTED_MAPPING, providerSessionId: '' }]) {
    f.send({ expectedProviderMapping });
    await settle();
    assert.equal(f.frames.at(-1)?.code, 'RECOVERY_MAPPING_REQUIRED');
  }
  assert.equal(f.runs.length, 0);
});

test('recovery reserves the run before an edit can change its mapping', async (t) => {
  const f = await fixture(t);
  let releaseRun = () => {};
  const heldRun = new Promise<void>((resolve) => { releaseRun = resolve; });
  const rewind = t.mock.method(sessionsService, 'rewindSessionForEdit', async () => {});
  t.mock.method(sessionsService, 'resolveEditAnchor', async () => ({
    found: true, resumeThroughId: 'previous-turn',
  }));
  t.mock.method(sessionsService, 'providerRewindsForEdit', () => true);
  f.runtime.run = async () => { await heldRun; };
  try {
    f.send();
    // No yield: the recovery must already own the run at this point.
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true);
    f.send({ type: 'chat.edit-send', anchorId: 'edited-turn' });
    await settle();
    assert.equal(f.frames.at(-1)?.code, 'RUN_IN_PROGRESS');
    assert.equal(rewind.mock.callCount(), 0);
    assert.equal(sessionsDb.getSessionById(SESSION_ID)?.provider_session_id, 'captured-thread');
  } finally {
    releaseRun();
    await settle();
  }
});

test('an edit already admitted blocks recovery before its asynchronous rewind', async (t) => {
  const f = await fixture(t);
  let releaseRewind = () => {};
  const heldRewind = new Promise<void>((resolve) => { releaseRewind = resolve; });
  t.mock.method(sessionsService, 'resolveEditAnchor', async () => ({
    found: true, resumeThroughId: 'previous-turn',
  }));
  t.mock.method(sessionsService, 'providerRewindsForEdit', () => true);
  t.mock.method(sessionsService, 'rewindSessionForEdit', async () => {
    await heldRewind;
    sessionsDb.repointSessionToProviderSession(SESSION_ID, {
      providerSessionId: 'edited-thread', jsonlPath: '/unused/edited.jsonl',
    });
  });
  try {
    f.send({ type: 'chat.edit-send', anchorId: 'edited-turn' });
    await settle();
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), true);
    f.send();
    await settle();
    assert.equal(f.frames.at(-1)?.code, 'RUN_IN_PROGRESS');
    assert.equal(f.runs.length, 0);
  } finally {
    releaseRewind();
    await settle();
  }
  assert.equal(f.runs.length, 1);
  assert.equal(f.runs[0]?.nativeId, 'edited-thread');
  f.send();
  await settle();
  assert.equal(f.frames.at(-1)?.code, 'RECOVERY_MAPPING_CHANGED');
  assert.equal(f.runs.length, 1);
});
