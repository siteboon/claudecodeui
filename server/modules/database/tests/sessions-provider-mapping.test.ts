import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-mapping-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

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

test('disk-discovered sessions are keyed by the provider id for both columns', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('provider-abc', 'claude', '/workspace/demo', 'From Disk');

    const row = sessionsDb.getSessionById('provider-abc');
    assert.equal(row?.session_id, 'provider-abc');
    assert.equal(row?.provider_session_id, 'provider-abc');

    const byProviderId = sessionsDb.getSessionByProviderSessionId('provider-abc');
    assert.equal(byProviderId?.session_id, 'provider-abc');
  });
});

test('app sessions get the provider id assigned without creating a duplicate row', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-id-1', 'claude', '/workspace/demo', 'Initial CloudCLI message');
    sessionsDb.assignProviderSessionId('app-id-1', 'provider-xyz');

    // A later synchronizer pass that discovers the transcript on disk must
    // update the app row in place instead of inserting a provider-keyed row.
    const returnedId = sessionsDb.createSession(
      'provider-xyz',
      'claude',
      '/workspace/demo',
      'Synced Name',
      undefined,
      undefined,
      '/fake/path/provider-xyz.jsonl',
    );

    assert.equal(returnedId, 'app-id-1');
    assert.equal(sessionsDb.getAllSessions().length, 1);

    const row = sessionsDb.getSessionById('app-id-1');
    assert.equal(row?.provider_session_id, 'provider-xyz');
    assert.equal(row?.jsonl_path, '/fake/path/provider-xyz.jsonl');
    assert.equal(row?.custom_name, 'Initial CloudCLI message');
  });
});

test('app sessions retain their selected runtime profile', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession(
      'app-profile-1',
      'codex',
      '/workspace/demo',
      'Profile session',
      'codex-work',
    );

    assert.equal(
      sessionsDb.getSessionById('app-profile-1')?.runtime_profile_id,
      'codex-work',
    );
  });
});

test('assignProviderSessionId merges a watcher-created duplicate into the app row', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-id-2', 'codex', '/workspace/demo');

    // Simulate the race: the filesystem watcher indexed the provider
    // transcript before the runtime announced its session id to the gateway.
    sessionsDb.createSession(
      'provider-race',
      'codex',
      '/workspace/demo',
      'Watcher Name',
      undefined,
      undefined,
      '/fake/provider-race.jsonl',
    );
    assert.equal(sessionsDb.getAllSessions().length, 2);

    sessionsDb.assignProviderSessionId('app-id-2', 'provider-race');

    const rows = sessionsDb.getAllSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.session_id, 'app-id-2');
    assert.equal(rows[0]?.provider_session_id, 'provider-race');
    // Transcript path and name from the duplicate are adopted.
    assert.equal(rows[0]?.jsonl_path, '/fake/provider-race.jsonl');
    assert.equal(rows[0]?.custom_name, 'Watcher Name');
  });
});

test('legacy provider-keyed rows stay resolvable through both lookups', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('legacy-1', 'opencode', '/workspace/demo');

    assert.equal(sessionsDb.getSessionById('legacy-1')?.provider, 'opencode');
    assert.equal(sessionsDb.getSessionByProviderSessionId('legacy-1')?.session_id, 'legacy-1');
  });
});

for (const provider of ['claude', 'codex']) {
  for (const profiles of [[null, 'work'], ['work', null], ['a-work', 'z-work'], ['z-work', 'a-work']]) {
    test(`${provider} duplicate transcript ids retain one home in order ${JSON.stringify(profiles)}`, async () => {
      await withIsolatedDatabase(async () => {
        const root = path.dirname(process.env.DATABASE_PATH!);
        for (const profile of profiles) {
          const transcript = path.join(root, profile ?? 'default', 'copied.jsonl');
          await mkdir(path.dirname(transcript), { recursive: true });
          await writeFile(transcript, '{}\n');
          sessionsDb.createSession('copied-id', provider, '/workspace/demo', `From ${profile}`,
            undefined, undefined, transcript, profile);
        }
        const owner = [...profiles].sort((a, b) => (a ?? '') < (b ?? '') ? -1 : 1)[0];
        const row = sessionsDb.getSessionByProviderSessionId('copied-id');
        assert.equal(row?.runtime_profile_id, owner);
        assert.equal(row?.jsonl_path, path.join(root, owner ?? 'default', 'copied.jsonl'));
        assert.equal(row?.custom_name, `From ${owner}`);
      });
    });
  }
}

test('a surviving native transcript takes ownership after the preferred copy disappears', async () => {
  await withIsolatedDatabase(async () => {
    const root = path.dirname(process.env.DATABASE_PATH!);
    const preferred = path.join(root, 'default.jsonl');
    const surviving = path.join(root, 'work.jsonl');
    await writeFile(preferred, '{}\n');
    await writeFile(surviving, '{}\n');
    sessionsDb.createSession('copied-id', 'codex', root, 'Default', undefined, undefined, preferred, null);
    await rm(preferred);
    sessionsDb.createSession('copied-id', 'codex', root, 'Work', undefined, undefined, surviving, 'work');
    const row = sessionsDb.getSessionByProviderSessionId('copied-id');
    assert.equal(row?.runtime_profile_id, 'work');
    assert.equal(row?.jsonl_path, surviving);
  });
});

for (const selected of [null, 'work']) {
  test(`app transcript discoveries must match the explicitly selected ${selected ?? 'default'} profile`, async () => {
    await withIsolatedDatabase(() => {
      const other = selected === null ? 'work' : null;
      sessionsDb.createAppSession('app-selected', 'codex', '/workspace/demo', 'My title', selected);
      sessionsDb.assignProviderSessionId('app-selected', 'native-selected');
      sessionsDb.createSession('native-selected', 'codex', '/workspace/demo', 'Other account',
        undefined, undefined, '/other/account.jsonl', other);
      assert.equal(sessionsDb.getSessionById('app-selected')?.jsonl_path, null);
      sessionsDb.createSession('native-selected', 'codex', '/workspace/demo', 'Selected account',
        undefined, undefined, '/selected/account.jsonl', selected);
      const row = sessionsDb.getSessionById('app-selected');
      assert.equal(row?.jsonl_path, '/selected/account.jsonl');
      assert.equal(row?.runtime_profile_id, selected);
      assert.equal(row?.custom_name, 'My title');
    });
  });
  test(`a watcher race cannot import another profile into an app using ${selected ?? 'default'}`, async () => {
    await withIsolatedDatabase(() => {
      sessionsDb.createAppSession('app-race', 'codex', '/workspace/demo', undefined, selected);
      sessionsDb.createSession('native-race', 'codex', '/workspace/demo', 'Copied account',
        undefined, undefined, '/other/account.jsonl', selected === null ? 'work' : null);
      sessionsDb.assignProviderSessionId('app-race', 'native-race');
      const row = sessionsDb.getSessionById('app-race');
      assert.equal(row?.jsonl_path, null);
      assert.equal(row?.runtime_profile_id, selected);
      assert.equal(row?.provider_session_id, 'native-race');
      assert.equal(row?.custom_name, null);
      assert.equal(sessionsDb.getAllSessions().length, 1);
    });
  });
}

test('ownership-checked discovery can fill an untitled app session from its own profile', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('untitled-app', 'codex', '/workspace/demo', 'Untitled Codex Session', 'work');
    sessionsDb.assignProviderSessionId('untitled-app', 'untitled-native');
    sessionsDb.createSession('untitled-native', 'codex', '/workspace/demo', 'Wrong account title',
      undefined, undefined, '/other/transcript.jsonl', null);
    assert.equal(sessionsDb.getSessionById('untitled-app')?.custom_name, 'Untitled Codex Session');
    sessionsDb.createSession('untitled-native', 'codex', '/workspace/demo', 'Own account title',
      undefined, undefined, '/work/transcript.jsonl', 'work');
    assert.equal(sessionsDb.getSessionById('untitled-app')?.custom_name, 'Own account title');
  });
});
