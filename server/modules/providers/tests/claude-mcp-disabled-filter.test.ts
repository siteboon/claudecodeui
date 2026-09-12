import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyMcpDisabledFilter } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import {
  closeConnection,
  getConnection,
  initializeDatabase,
  mcpDisabledServersDb,
  normalizeMcpDisabledServers,
  userPreferencesDb,
} from '@/modules/database/index.js';

const USER_ID = 1;

const SERVERS = {
  github: { command: 'github-server' },
  fetch: { command: 'fetch-server' },
  'memory core': { command: 'memory-server' },
};

test('a disabled name drops the server and leaves the rest alone', () => {
  const kept = applyMcpDisabledFilter(SERVERS, ['fetch']);
  assert.deepEqual(Object.keys(kept ?? {}), ['github', 'memory core']);
});

test('disabling every name yields null, the same shape as "no MCP config"', () => {
  const kept = applyMcpDisabledFilter(SERVERS, ['github', 'fetch', 'memory core']);
  assert.equal(kept, null);
});

test('an empty disable set is the identity', () => {
  assert.equal(applyMcpDisabledFilter(SERVERS, []), SERVERS);
  assert.equal(applyMcpDisabledFilter(SERVERS, null), SERVERS);
});

test('missing or malformed server configs pass through as null', () => {
  assert.equal(applyMcpDisabledFilter(null, ['github']), null);
  assert.equal(applyMcpDisabledFilter(undefined as never, null), null);
});

test('names are trimmed on both sides of the comparison', () => {
  const kept = applyMcpDisabledFilter({ ' spaced ': {}, keep: {} }, ['spaced']);
  assert.deepEqual(Object.keys(kept ?? {}), ['keep']);
});

test('normalization drops junk entries, blanks, and duplicates', () => {
  assert.deepEqual(
    normalizeMcpDisabledServers([' github ', 'github', '', 42, null, 'fetch']),
    ['fetch', 'github'],
  );
  assert.deepEqual(normalizeMcpDisabledServers('not an array'), []);
  assert.deepEqual(normalizeMcpDisabledServers(undefined), []);
});

async function withDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'mcp-disabled-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  // The table cascades from users(id), so a row has to exist to write against.
  getConnection()
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(USER_ID, 'tester', 'hash');

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('the disabled set round-trips through user_preferences', async () => {
  await withDatabase(() => {
    assert.deepEqual(mcpDisabledServersDb.get(USER_ID), []);
    mcpDisabledServersDb.set(USER_ID, ['github', ' github ', 'fetch']);
    assert.deepEqual(mcpDisabledServersDb.get(USER_ID), ['fetch', 'github']);

    // It lives in the shared preferences table under its own key, so the
    // frontend's preference mirror sees the same list without another route.
    const mirror = userPreferencesDb.getPreferences(USER_ID);
    assert.deepEqual(mirror.mcpDisabledServers, ['fetch', 'github']);
  });
});

test('setting replaces the whole set rather than merging', async () => {
  await withDatabase(() => {
    mcpDisabledServersDb.set(USER_ID, ['github', 'fetch']);
    mcpDisabledServersDb.set(USER_ID, ['memory']);
    assert.deepEqual(mcpDisabledServersDb.get(USER_ID), ['memory']);
  });
});

test('a corrupted stored list reads as nothing disabled', async () => {
  await withDatabase(() => {
    getConnection()
      .prepare(
        `INSERT INTO user_preferences (user_id, preference_key, preference_value)
         VALUES (?, ?, ?)`
      )
      .run(USER_ID, 'mcpDisabledServers', 'not json');

    assert.deepEqual(mcpDisabledServersDb.get(USER_ID), []);
  });
});
