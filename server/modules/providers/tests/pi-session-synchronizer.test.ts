import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { PiSessionSynchronizer } from '@/modules/providers/list/pi/pi-session-synchronizer.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'pi-synchronizer-db-'));
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

const SESSION_ONE_ID = '01a095e3-bb8a-72a9-83a6-66b7c73b176d';
const SESSION_TWO_ID = '02b106f4-cc9b-83ba-94b7-77c8d84c287e';
const SESSION_THREE_ID = '03c217a5-ddac-94cb-a5c8-88d9e95d398f';

const sessionHeaderLine = (sessionId: string, timestamp: string, cwd: string) =>
  JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp, cwd });

const userMessageLine = (text: string) =>
  JSON.stringify({
    type: 'message',
    id: 'm-user',
    parentId: null,
    timestamp: '2026-09-12T13:52:06.000Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'glm-5.3',
      stopReason: 'stop',
      usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
    },
  });

/**
 * Writes one pi transcript the way pi 0.85.1 lays sessions out on disk:
 * `~/.pi/agent/sessions/<encoded-cwd>/<ISO timestamp>_<session uuid>.jsonl`.
 */
async function writePiSession(
  homeDir: string,
  options: {
    encodedCwd: string;
    fileName: string;
    lines: string[];
    mtime?: Date;
  },
): Promise<string> {
  const sessionDirectory = path.join(homeDir, '.pi', 'agent', 'sessions', options.encodedCwd);
  await mkdir(sessionDirectory, { recursive: true });
  const filePath = path.join(sessionDirectory, options.fileName);
  await writeFile(filePath, `${options.lines.join('\n')}\n`, 'utf8');
  if (options.mtime) {
    await utimes(filePath, options.mtime, options.mtime);
  }
  return filePath;
}

async function withIsolatedPiHome(run: (homeDir: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pi-synchronizer-home-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await run(tempRoot);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('synchronize upserts pi sessions into the sidebar db', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const projectOne = path.join(homeDir, 'workspaces', 'checkout');
    const projectTwo = path.join(homeDir, 'workspaces', 'docs');

    // Long enough that the 120-char session name bound kicks in.
    const longPrompt = `Fix the login redirect loop${' and keep the retry budget intact'.repeat(4)}`;
    await writePiSession(homeDir, {
      encodedCwd: '--x--',
      fileName: `2026-09-12T13-52-05-003Z_${SESSION_ONE_ID}.jsonl`,
      lines: [
        sessionHeaderLine(SESSION_ONE_ID, '2026-09-12T13:52:05.003Z', projectOne),
        userMessageLine(longPrompt),
      ],
    });
    // A header-only transcript: the session still gets indexed, untitled.
    await writePiSession(homeDir, {
      encodedCwd: '--y--',
      fileName: `2026-09-12T14-00-00-000Z_${SESSION_TWO_ID}.jsonl`,
      lines: [sessionHeaderLine(SESSION_TWO_ID, '2026-09-12T14:00:00.000Z', projectTwo)],
    });

    await withIsolatedDatabase(async () => {
      const processed = await new PiSessionSynchronizer().synchronize(new Date(0));
      assert.equal(processed, 2);

      const first = sessionsDb.getSessionByProviderSessionId(SESSION_ONE_ID);
      assert.equal(first?.provider, 'pi');
      assert.equal(first?.project_path, projectOne);
      // The name comes from the first user message, truncated to the standard bound.
      assert.equal(first?.custom_name?.length, 120);
      assert.ok(first?.custom_name?.startsWith('Fix the login redirect loop'));
      // pi keeps every transcript in one shared tree, so the row must never
      // claim a deletable jsonl path (same reasoning as opencode).
      assert.equal(first?.jsonl_path, null);
      assert.equal(first?.created_at, '2026-09-12T13:52:05.003Z');

      const second = sessionsDb.getSessionByProviderSessionId(SESSION_TWO_ID);
      assert.equal(second?.provider, 'pi');
      assert.equal(second?.project_path, projectTwo);
      assert.equal(second?.custom_name, 'Untitled pi Session');
    });
  });
});

test('synchronizeFile only handles pi session jsonl files', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'workspaces', 'changelog');
    const transcriptPath = await writePiSession(homeDir, {
      encodedCwd: '--z--',
      fileName: `2026-09-12T15-00-00-000Z_${SESSION_THREE_ID}.jsonl`,
      lines: [
        sessionHeaderLine(SESSION_THREE_ID, '2026-09-12T15:00:00.000Z', projectPath),
        userMessageLine('Summarize the changelog'),
      ],
    });

    await withIsolatedDatabase(async () => {
      const synchronizer = new PiSessionSynchronizer();

      // Foreign artifacts (opencode's sqlite store, stray jsonl elsewhere)
      // must not be touched.
      assert.equal(await synchronizer.synchronizeFile('/tmp/opencode.db'), null);
      assert.equal(await synchronizer.synchronizeFile(path.join(homeDir, 'notes.jsonl')), null);

      const sessionId = await synchronizer.synchronizeFile(transcriptPath);
      assert.equal(sessionId, SESSION_THREE_ID);

      const indexed = sessionsDb.getSessionByProviderSessionId(SESSION_THREE_ID);
      assert.equal(indexed?.provider, 'pi');
      assert.equal(indexed?.project_path, projectPath);
      assert.equal(indexed?.custom_name, 'Summarize the changelog');
    });
  });
});

test('synchronize(since) skips files whose mtime is older than the cursor', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'workspaces', 'old-and-new');
    await writePiSession(homeDir, {
      encodedCwd: '--old--',
      fileName: `2026-09-12T09-00-00-000Z_${SESSION_ONE_ID}.jsonl`,
      lines: [sessionHeaderLine(SESSION_ONE_ID, '2026-09-12T09:00:00.000Z', projectPath)],
      mtime: new Date(Date.now() - 3_600_000),
    });
    await writePiSession(homeDir, {
      encodedCwd: '--new--',
      fileName: `2026-09-12T16-00-00-000Z_${SESSION_TWO_ID}.jsonl`,
      lines: [sessionHeaderLine(SESSION_TWO_ID, '2026-09-12T16:00:00.000Z', projectPath)],
    });

    await withIsolatedDatabase(async () => {
      const processed = await new PiSessionSynchronizer().synchronize(
        new Date(Date.now() - 1_800_000),
      );
      assert.equal(processed, 1);
      assert.equal(sessionsDb.getSessionByProviderSessionId(SESSION_TWO_ID)?.provider, 'pi');
      assert.equal(sessionsDb.getSessionByProviderSessionId(SESSION_ONE_ID), null);

      // A full scan (no cursor) still picks the older file up.
      assert.equal(await new PiSessionSynchronizer().synchronize(), 2);
      assert.ok(sessionsDb.getSessionByProviderSessionId(SESSION_ONE_ID));
    });
  });
});

test('synchronizeFile adopts the pending app session instead of creating a duplicate', async () => {
  await withIsolatedPiHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'workspaces', 'race');
    const transcriptPath = await writePiSession(homeDir, {
      encodedCwd: '--race--',
      fileName: `2026-09-12T17-00-00-000Z_${SESSION_ONE_ID}.jsonl`,
      lines: [
        sessionHeaderLine(SESSION_ONE_ID, '2026-09-12T17:00:00.000Z', projectPath),
        userMessageLine('Why is the build red?'),
      ],
    });

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-session-1', 'pi', projectPath, 'Why is the build red?');

      const sessionId = await new PiSessionSynchronizer().synchronizeFile(transcriptPath);

      assert.equal(sessionId, 'app-session-1');
      assert.equal(sessionsDb.getAllSessions().length, 1);
      const adopted = sessionsDb.getSessionById('app-session-1');
      assert.equal(adopted?.provider_session_id, SESSION_ONE_ID);
      assert.equal(adopted?.custom_name, 'Why is the build red?');
    });
  });
});
