import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-sync-'));
process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');

const { initializeDatabase, sessionsDb, scanStateDb } = await import(
  '@/modules/database/index.js'
);
const { CursorSessionSynchronizer } = await import(
  '@/modules/providers/list/cursor/cursor-session-synchronizer.provider.js'
);
const { closeConnection } = await import('@/modules/database/connection.js');

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const writeJsonl = async (filePath: string, rows: unknown[]) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
};

const userQueryRow = (text: string) => ({
  role: 'user',
  message: { content: [{ type: 'text', text: `<user_query>\n${text}\n</user_query>` }] },
});

/**
 * Cursor's transcript layout has shifted over time:
 *   - jsonl at agent-transcripts/<chatId>/<chatId>.jsonl              (current)
 *   - jsonl at agent-transcripts/<chatId>/<sub>/<chatId>.jsonl        (older)
 * Both must be picked up. The legacy ~/.cursor/chats/<projectHash>/
 * directory now holds only SQLite store.db files used by the loader.
 */
test('CursorSessionSynchronizer indexes transcripts at both nested depths', { concurrency: false }, async () => {
  const restoreHomeDir = patchHomeDir(tempRoot);
  try {
    await initializeDatabase();

    const cursorHome = path.join(tempRoot, '.cursor');
    const projectsDir = path.join(cursorHome, 'projects');
    const projectDir = path.join(projectsDir, 'home-coder-cc-backend');
    const transcriptsDir = path.join(projectDir, 'agent-transcripts');

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'worker.log'),
      [
        '[info] starting worker',
        '[info] Getting tree structure for workspacePath=/home/coder/cc-backend',
      ].join('\n')
    );

    const shallowChatId = '11111111-2222-3333-4444-555555555555';
    const shallowJsonl = path.join(transcriptsDir, shallowChatId, `${shallowChatId}.jsonl`);
    await writeJsonl(shallowJsonl, [userQueryRow('refactor the watchtower analytics route')]);

    const deepChatId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const deepJsonl = path.join(transcriptsDir, deepChatId, 'turn-001', `${deepChatId}.jsonl`);
    await writeJsonl(deepJsonl, [userQueryRow('add a parity test for the bun build')]);

    // Project that lacks worker.log — must be ignored, not crash the scan.
    await fs.mkdir(path.join(projectsDir, 'tmp-orphan'), { recursive: true });
    await writeJsonl(
      path.join(projectsDir, 'tmp-orphan', 'agent-transcripts', 'orphan', 'orphan.jsonl'),
      [userQueryRow('orphan')]
    );

    // Legacy ~/.cursor/chats SQLite presence must NOT cause indexer to claim sessions.
    await fs.mkdir(path.join(cursorHome, 'chats', 'deadbeef'), { recursive: true });
    await fs.writeFile(path.join(cursorHome, 'chats', 'deadbeef', 'store.db'), '');

    const sync = new CursorSessionSynchronizer();
    const processed = await sync.synchronize();
    assert.equal(processed, 2, 'should index both shallow and deep transcripts');

    const shallow = sessionsDb.getSessionById(shallowChatId);
    assert.ok(shallow, 'shallow session indexed');
    assert.equal(shallow!.provider, 'cursor');
    assert.equal(shallow!.project_path, '/home/coder/cc-backend');
    assert.match(shallow!.custom_name ?? '', /watchtower analytics/);

    const deep = sessionsDb.getSessionById(deepChatId);
    assert.ok(deep, 'deep session indexed');
    assert.equal(deep!.project_path, '/home/coder/cc-backend');
    assert.match(deep!.custom_name ?? '', /parity test/);

    // Per-file path used by the watcher must also resolve project_path
    // for transcripts at both depths without a hint.
    const ad = path.join(transcriptsDir, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
    const adHocJsonl = path.join(ad, 'cccccccc-cccc-cccc-cccc-cccccccccccc.jsonl');
    await writeJsonl(adHocJsonl, [userQueryRow('hot-added by watcher')]);
    const indexedId = await sync.synchronizeFile(adHocJsonl);
    assert.equal(indexedId, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
    const adHoc = sessionsDb.getSessionById('cccccccc-cccc-cccc-cccc-cccccccccccc');
    assert.equal(adHoc!.project_path, '/home/coder/cc-backend');

    // Transcripts outside ~/.cursor/projects must be rejected.
    const outsideJsonl = path.join(tempRoot, 'random', 'dddddddd.jsonl');
    await writeJsonl(outsideJsonl, [userQueryRow('outside cursor home')]);
    assert.equal(await sync.synchronizeFile(outsideJsonl), null);

    // Incremental rescan with `since` set to now finds nothing new.
    scanStateDb.updateLastScannedAt(new Date(Date.now() + 60_000));
    const reprocessed = await sync.synchronize(scanStateDb.getLastScannedAt() ?? undefined);
    assert.equal(reprocessed, 0, 'incremental scan should skip files older than `since`');
  } finally {
    closeConnection();
    restoreHomeDir();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
