import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  queuedMessagesDb,
  sessionDraftsDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import { queuedMessagesService } from '@/modules/scheduled-messages/services/queued-messages.service.js';
import {
  initializeScheduledMessageDispatcher,
  closeScheduledMessageDispatcher,
} from '@/modules/scheduled-messages/index.js';
import { dispatchQueuedMessages } from '@/modules/scheduled-messages/services/scheduled-message-dispatcher.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

async function isolated(run: (userId: number) => Promise<void>) {
  const oldPath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'fifo-queue-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const userId = Number(userDb.createUser('queue-user', 'hash').id);
  sessionsDb.createAppSession('session', 'codex', directory, 'Queue');
  try {
    await run(userId);
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (oldPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = oldPath;
    await rm(directory, { recursive: true, force: true });
  }
}
function enqueue(userId: number, id: string) {
  return queuedMessagesService.enqueue(userId, {
    id,
    sessionId: 'session',
    content: id,
  });
}
function steerBody(message: ReturnType<typeof enqueue>, requestId = 'request') {
  return {
    messageId: message.id,
    revision: message.revision,
    requestId,
    sessionId: 'session',
    activeTurnToken: 'turn-A',
  };
}
function runtime(run: ProviderRuntimeGateway['run']): ProviderRuntimeGateway {
  return {
    hasRuntime: () => true,
    run,
    abort: async () => true,
    stopBackgroundTask: async () => false,
    hasBackgroundWork: () => false,
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
  };
}

test('three queue entries survive independently and dispatch in FIFO order', async () =>
  isolated(async (userId) => {
    enqueue(userId, 'B');
    enqueue(userId, 'C');
    enqueue(userId, 'D');
    assert.deepEqual(
      queuedMessagesService.list(userId, 'session').map((item) => item.content),
      ['B', 'C', 'D'],
    );
    const sent: string[] = [];
    const gateway = runtime(async (_provider, content) => {
      sent.push(content);
    });
    for (let i = 0; i < 3; i++)
      assert.equal(await dispatchQueuedMessages(gateway), 1);
    assert.deepEqual(sent, ['B', 'C', 'D']);
    assert.deepEqual(queuedMessagesService.list(userId, 'session'), []);
  }));

test('duplicate enqueue is idempotent and an edit preserves identity and position', async () =>
  isolated(async (userId) => {
    enqueue(userId, 'B');
    const c = enqueue(userId, 'C');
    enqueue(userId, 'D');
    enqueue(userId, 'B');
    const edited = queuedMessagesService.update(userId, c.id, {
      revision: c.revision,
      content: 'edited C',
      attachments: [{ path: '/tmp/attachment.pdf', name: 'attachment.pdf' }],
    });
    assert.equal(edited.sequence, c.sequence);
    assert.equal(edited.revision, c.revision + 1);
    assert.deepEqual(
      queuedMessagesService.list(userId, 'session').map((item) => item.content),
      ['B', 'edited C', 'D'],
    );
    assert.throws(
      () => queuedMessagesService.cancel(userId, c.id, c.revision),
      /changed/,
    );
    queuedMessagesService.cancel(userId, c.id, edited.revision);
    assert.deepEqual(
      queuedMessagesService.list(userId, 'session').map((item) => item.content),
      ['B', 'D'],
    );
  }));

test('two dispatchers cannot consume the same item or start the next while it is running', async () =>
  isolated(async (userId) => {
    enqueue(userId, 'B');
    enqueue(userId, 'C');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const gateway = runtime(async () => {
      calls += 1;
      await held;
    });
    const first = dispatchQueuedMessages(gateway);
    assert.equal(await dispatchQueuedMessages(gateway), 0);
    assert.equal(calls, 1);
    release();
    await first;
    assert.equal(queuedMessagesService.list(userId, 'session')[0]?.id, 'C');
  }));

test('steering a later item consumes only that item and a repeated request sends no second RPC', async () =>
  isolated(async (userId) => {
    enqueue(userId, 'B');
    const c = enqueue(userId, 'C');
    enqueue(userId, 'D');
    let calls = 0;
    const body = steerBody(c);
    assert.equal(
      (
        await queuedMessagesService.steer(userId, body, async () => {
          calls += 1;
        })
      ).status,
      'accepted',
    );
    assert.equal(
      (
        await queuedMessagesService.steer(userId, body, async () => {
          calls += 1;
        })
      ).status,
      'accepted',
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      queuedMessagesService.list(userId, 'session').map((item) => item.id),
      ['B', 'D'],
    );
    await assert.rejects(
      queuedMessagesService.steer(
        userId,
        { ...body, activeTurnToken: 'turn-B' },
        async () => {},
      ),
      /changed/,
    );
  }));

test('a steer reservation excludes dispatch and editing until its correlated result', async () =>
  isolated(async (userId) => {
    const b = enqueue(userId, 'B');
    enqueue(userId, 'C');
    let release!: () => void;
    const pending = queuedMessagesService.steer(
      userId,
      steerBody(b),
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    assert.equal(
      await dispatchQueuedMessages(
        runtime(async () => {
          throw new Error('must not run');
        }),
      ),
      0,
    );
    assert.throws(
      () =>
        queuedMessagesService.update(userId, b.id, {
          revision: b.revision,
          content: 'changed',
        }),
      /changed/,
    );
    release();
    assert.equal((await pending).status, 'accepted');
  }));

test('explicit rejection restores the item; timeout blocks it and later entries without losing content', async () =>
  isolated(async (userId) => {
    const b = enqueue(userId, 'B');
    enqueue(userId, 'C');
    assert.equal(
      (
        await queuedMessagesService.steer(userId, steerBody(b), async () => {
          throw new AppError('turn changed', {
            code: 'ACTIVE_TURN_CHANGED',
            statusCode: 409,
          });
        })
      ).status,
      'rejected',
    );
    const restored = queuedMessagesService.list(userId, 'session')[0];
    assert.equal(restored.content, 'B');
    assert.equal(restored.status, 'queued');
    assert.equal(
      (
        await queuedMessagesService.steer(
          userId,
          steerBody(restored, 'retry'),
          async () => {
            throw new Error('RPC timed out');
          },
        )
      ).status,
      'unknown',
    );
    assert.equal(
      await dispatchQueuedMessages(
        runtime(async () => {
          throw new Error('must not run');
        }),
      ),
      0,
    );
    assert.equal(queuedMessagesService.list(userId, 'session')[0].content, 'B');
  }));

test('failed normal dispatch preserves the message and pauses the FIFO', async () =>
  isolated(async (userId) => {
    enqueue(userId, 'B');
    enqueue(userId, 'C');
    await dispatchQueuedMessages(
      runtime(async () => {
        throw new Error('provider failed');
      }),
    );
    const rows = queuedMessagesService.list(userId, 'session');
    assert.equal(rows[0].status, 'failed');
    assert.match(rows[0].error!, /provider failed/);
    assert.equal(rows[1].status, 'queued');
    assert.equal(await dispatchQueuedMessages(runtime(async () => {})), 0);
  }));

test('restart marks outstanding claims unknown and never resends them', async () =>
  isolated(async (userId) => {
    const b = enqueue(userId, 'B');
    enqueue(userId, 'C');
    assert.equal(queuedMessagesDb.reserveSteer(b, 'request', 'turn-A'), true);
    queuedMessagesDb.recoverClaims();
    assert.equal(
      queuedMessagesService.result(userId, 'request')?.status,
      'unknown',
    );
    assert.equal(await dispatchQueuedMessages(runtime(async () => {})), 0);
  }));

test('legacy slot migrates once, preserving attachments and composer text', async () =>
  isolated(async (userId) => {
    sessionDraftsDb.saveDraft(userId, 'session', {
      text: 'still typing',
      queuedMessage: {
        content: 'legacy',
        images: [{ path: '/tmp/image.png' }],
        options: { model: 'saved-model' },
      },
    });
    await initializeDatabase();
    await initializeDatabase();
    const items = queuedMessagesService.list(userId, 'session');
    assert.equal(items.length, 1);
    assert.equal(items[0].content, 'legacy');
    assert.equal(items[0].attachments[0].path, '/tmp/image.png');
    assert.equal(items[0].options.model, 'saved-model');
    assert.equal(sessionDraftsDb.getDrafts(userId)[0].text, 'still typing');
    assert.equal(sessionDraftsDb.getDrafts(userId)[0].queuedMessage, null);
  }));

test('another user cannot edit, cancel or steer an entry', async () =>
  isolated(async (userId) => {
    const message = enqueue(userId, 'B');
    const other = Number(userDb.createUser('other-user', 'hash').id);
    assert.throws(
      () =>
        queuedMessagesService.update(other, message.id, {
          revision: 1,
          content: 'stolen',
        }),
      /changed/,
    );
    assert.throws(
      () => queuedMessagesService.cancel(other, message.id, 1),
      /changed/,
    );
    await assert.rejects(
      queuedMessagesService.steer(other, steerBody(message), async () => {}),
      /changed/,
    );
  }));

test('production dispatcher advances one FIFO while another session remains busy', async () =>
  isolated(async (userId) => {
    sessionsDb.createAppSession(
      'other-session',
      'codex',
      sessionsDb.getSessionById('session')!.project_path!,
      'Other',
    );
    enqueue(userId, 'long-running');
    enqueue(userId, 'wait-for-long');
    queuedMessagesService.enqueue(userId, {
      id: 'quick',
      sessionId: 'other-session',
      content: 'quick',
    });
    queuedMessagesService.enqueue(userId, {
      id: 'next-quick',
      sessionId: 'other-session',
      content: 'next-quick',
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const gateway = runtime(async (_provider, content) => {
      calls.push(content);
      if (content === 'long-running') await held;
    });
    initializeScheduledMessageDispatcher(gateway);
    try {
      for (let i = 0; i < 10 && !calls.includes('next-quick'); i++)
        await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(calls.includes('next-quick'));
      assert.equal(calls.includes('wait-for-long'), false);
    } finally {
      closeScheduledMessageDispatcher();
      release();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }));
