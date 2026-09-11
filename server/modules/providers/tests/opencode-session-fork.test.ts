import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { openCodeServer } from '@/modules/providers/list/opencode/opencode-server.client.js';
import { OpenCodeForkProvider } from '@/modules/providers/list/opencode/opencode-fork.provider.js';

/**
 * The fork endpoint itself is exercised against a real `opencode serve` during
 * manual verification; what these cover is the mapping either side of it: what
 * the provider asks the endpoint for, and how a message anchor turns into the
 * endpoint's exclusive cut point.
 */

/** Seeds an opencode.db whose messages land in a known read order. */
const seedOpenCodeDatabase = async (
  homeDir: string,
  sessionId: string,
  messageIds: string[],
): Promise<void> => {
  const dataDir = path.join(homeDir, '.local', 'share', 'opencode');
  await mkdir(dataDir, { recursive: true });

  const db = new Database(path.join(dataDir, 'opencode.db'));
  try {
    db.exec(`
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    const insert = db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)');
    messageIds.forEach((id, index) => {
      insert.run(id, sessionId, 1_700_000_000_000 + index * 1_000, JSON.stringify({ role: 'user' }));
    });
  } finally {
    db.close();
  }
};

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

test('an OpenCode fork without an anchor copies the whole session', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-fork-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  await seedOpenCodeDatabase(tempRoot, 'ses_source', ['msg_a', 'msg_b', 'msg_c']);

  const realFork = openCodeServer.forkSession;
  const forkCalls: unknown[] = [];
  openCodeServer.forkSession = async (input) => {
    forkCalls.push(input);
    return { sessionId: 'ses_forked' };
  };

  try {
    const forked = await new OpenCodeForkProvider().forkSession({
      providerSessionId: 'ses_source',
      jsonlPath: null,
      projectPath: '/tmp/workspace',
      title: 'ignored by opencode',
    });
    // No path: the copy lives in the shared database, and a row naming no
    // file is what keeps deletion from touching opencode.db.
    assert.deepEqual(forked, { providerSessionId: 'ses_forked', jsonlPath: null });
  } finally {
    openCodeServer.forkSession = realFork;
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }

  assert.deepEqual(forkCalls, [{ sessionId: 'ses_source', directory: '/tmp/workspace' }]);
});

test('an OpenCode fork cuts before the message after the anchored one', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-fork-anchor-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  await seedOpenCodeDatabase(tempRoot, 'ses_source', ['msg_a', 'msg_b', 'msg_c']);

  const realFork = openCodeServer.forkSession;
  const forkCalls: unknown[] = [];
  openCodeServer.forkSession = async (input) => {
    forkCalls.push(input);
    return { sessionId: 'ses_forked' };
  };

  try {
    await new OpenCodeForkProvider().forkSession({
      providerSessionId: 'ses_source',
      jsonlPath: null,
      projectPath: '/tmp/workspace',
      upToAnchorId: 'msg_b',
    });
  } finally {
    openCodeServer.forkSession = realFork;
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }

  // The endpoint's cut is EXCLUSIVE of the id it names (verified against a
  // live server), while the contract's anchor means "keep this one too" — so
  // the fork must be asked to cut at the NEXT message, keeping msg_b itself.
  assert.deepEqual(forkCalls, [{
    sessionId: 'ses_source',
    cutBeforeMessageId: 'msg_c',
    directory: '/tmp/workspace',
  }]);
});

test('forking from the last OpenCode message copies the whole session', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-fork-last-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  await seedOpenCodeDatabase(tempRoot, 'ses_source', ['msg_a', 'msg_b']);

  const realFork = openCodeServer.forkSession;
  const forkCalls: unknown[] = [];
  openCodeServer.forkSession = async (input) => {
    forkCalls.push(input);
    return { sessionId: 'ses_forked' };
  };

  try {
    await new OpenCodeForkProvider().forkSession({
      providerSessionId: 'ses_source',
      jsonlPath: null,
      projectPath: '/tmp/workspace',
      upToAnchorId: 'msg_b',
    });
  } finally {
    openCodeServer.forkSession = realFork;
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }

  // Nothing follows the anchor, so "everything before the next message" is
  // the whole session — reported by asking without a cut point at all.
  assert.deepEqual(forkCalls, [{ sessionId: 'ses_source', directory: '/tmp/workspace' }]);
});

test('forking from a message that is gone from the database is refused', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-fork-missing-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  await seedOpenCodeDatabase(tempRoot, 'ses_source', ['msg_a']);

  const realFork = openCodeServer.forkSession;
  let called = false;
  openCodeServer.forkSession = async (input) => {
    called = true;
    void input;
    return { sessionId: 'ses_forked' };
  };

  try {
    await assert.rejects(
      () => new OpenCodeForkProvider().forkSession({
        providerSessionId: 'ses_source',
        jsonlPath: null,
        projectPath: '/tmp/workspace',
        upToAnchorId: 'msg_vanished',
      }),
      (error: Error & { code?: string }) => error.code === 'FORK_ANCHOR_NOT_FOUND',
    );
    assert.equal(called, false);
  } finally {
    openCodeServer.forkSession = realFork;
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
