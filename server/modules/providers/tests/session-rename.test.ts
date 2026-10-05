import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

/**
 * A rename made in CloudCLI lands in the Claude transcript as the row the CLI
 * writes for `/rename`, so `claude --resume` lists the session under the same
 * name as the sidebar. These drive the rename the way the REST route does and
 * read the transcript back.
 */

const CLI_SESSION_ID = '11111111-1111-4111-8111-111111111111';
const APP_NATIVE_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_PATH = '/tmp/claude-rename-project';
// A fixed time well in the past, so "the file kept its time" cannot pass by accident.
const OLD_MTIME = new Date('2026-09-01T12:00:00.000Z');

type Fixture = { home: string; projectDir: string };

async function withClaudeFixture(runTest: (fixture: Fixture) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const originalHomedir = os.homedir;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-rename-'));
  const home = path.join(tempDirectory, 'home');
  const projectDir = path.join(home, '.claude', 'projects', '-tmp-claude-rename-project');
  await mkdir(projectDir, { recursive: true });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  (os as any).homedir = () => home;
  await initializeDatabase();

  try {
    await runTest({ home, projectDir });
  } finally {
    closeConnection();
    (os as any).homedir = originalHomedir;
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** One finished turn, titled by the CLI, then the exit stamp it writes. */
function transcriptRows(providerSessionId: string): string[] {
  return [
    {
      type: 'user', parentUuid: null, isSidechain: false, cwd: PROJECT_PATH, sessionId: providerSessionId,
      uuid: `${providerSessionId}-u1`, timestamp: '2026-09-01T11:59:00.000Z',
      message: { role: 'user', content: 'Fix the login bug please' },
    },
    {
      type: 'assistant', parentUuid: `${providerSessionId}-u1`, isSidechain: false, cwd: PROJECT_PATH,
      sessionId: providerSessionId, uuid: `${providerSessionId}-a1`, timestamp: '2026-09-01T11:59:05.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    },
    { type: 'ai-title', aiTitle: 'Login bug fix', sessionId: providerSessionId },
    { type: 'last-prompt', lastPrompt: 'Fix the login bug please', leafUuid: `${providerSessionId}-a1`, sessionId: providerSessionId },
  ].map((row) => JSON.stringify(row));
}

async function writeTranscript(
  projectDir: string,
  providerSessionId: string,
  { trailingNewline = true }: { trailingNewline?: boolean } = {},
): Promise<string> {
  const filePath = path.join(projectDir, `${providerSessionId}.jsonl`);
  await writeFile(filePath, transcriptRows(providerSessionId).join('\n') + (trailingNewline ? '\n' : ''));
  await utimes(filePath, OLD_MTIME, OLD_MTIME);
  return filePath;
}

/** A session first seen on disk, as one started in the terminal is. */
async function indexCliSession(projectDir: string): Promise<string> {
  const filePath = await writeTranscript(projectDir, CLI_SESSION_ID);
  await new ClaudeSessionSynchronizer().synchronizeFile(filePath);
  return filePath;
}

const customTitleRow = (title: string, providerSessionId: string): string =>
  JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: providerSessionId });

test('a sidebar rename is written to the transcript as the row the CLI writes for /rename', { concurrency: false }, async () => {
  await withClaudeFixture(async ({ projectDir }) => {
    const filePath = await indexCliSession(projectDir);
    const before = await readFile(filePath, 'utf8');

    const result = await sessionsService.renameSessionById(CLI_SESSION_ID, 'Renamed in CloudCLI');

    assert.deepEqual(result, { sessionId: CLI_SESSION_ID, summary: 'Renamed in CloudCLI' });
    assert.equal(sessionsDb.getSessionById(CLI_SESSION_ID)?.custom_name, 'Renamed in CloudCLI');
    // Exactly one row appended, byte for byte what `/rename` writes, newline included.
    assert.equal(
      await readFile(filePath, 'utf8'),
      `${before}${customTitleRow('Renamed in CloudCLI', CLI_SESSION_ID)}\n`,
    );

    // The transcript now carries the name: indexing it afresh — another
    // CloudCLI, or this one after its database is gone — finds it there.
    sessionsDb.deleteSessionById(CLI_SESSION_ID);
    await new ClaudeSessionSynchronizer().synchronizeFile(filePath);
    assert.equal(sessionsDb.getSessionById(CLI_SESSION_ID)?.custom_name, 'Renamed in CloudCLI');
  });
});

test('a session started in CloudCLI is renamed under the id its transcript uses', { concurrency: false }, async () => {
  await withClaudeFixture(async ({ projectDir }) => {
    sessionsDb.createAppSession('app-session-1462', 'claude', PROJECT_PATH, 'Fix the login bug');
    sessionsDb.assignProviderSessionId('app-session-1462', APP_NATIVE_ID);
    const filePath = await writeTranscript(projectDir, APP_NATIVE_ID);
    await new ClaudeSessionSynchronizer().synchronizeFile(filePath);

    await sessionsService.renameSessionById('app-session-1462', 'Renamed in CloudCLI');

    const lastRow = (await readFile(filePath, 'utf8')).trimEnd().split('\n').at(-1);
    // The CLI only reads titles stamped with the transcript's own session id,
    // never CloudCLI's app id.
    assert.equal(lastRow, customTitleRow('Renamed in CloudCLI', APP_NATIVE_ID));
  });
});

test('a title with quotes, line breaks and non-ASCII text stays one row', { concurrency: false }, async () => {
  await withClaudeFixture(async ({ projectDir }) => {
    const filePath = await indexCliSession(projectDir);
    const rowsBefore = (await readFile(filePath, 'utf8')).split('\n').length;
    const title = 'Say "hi"\nthen — ünïcödé 日本語 🚀 \\ done';

    await sessionsService.renameSessionById(CLI_SESSION_ID, title);

    const lines = (await readFile(filePath, 'utf8')).split('\n');
    assert.equal(lines.length, rowsBefore + 1);
    assert.deepEqual(JSON.parse(lines.at(-2) ?? ''), {
      type: 'custom-title',
      customTitle: title,
      sessionId: CLI_SESSION_ID,
    });
  });
});

test('a transcript whose last row was cut off gets the title on a line of its own', { concurrency: false }, async () => {
  await withClaudeFixture(async ({ projectDir }) => {
    const filePath = await writeTranscript(projectDir, CLI_SESSION_ID, { trailingNewline: false });
    await new ClaudeSessionSynchronizer().synchronizeFile(filePath);
    const before = await readFile(filePath, 'utf8');

    await sessionsService.renameSessionById(CLI_SESSION_ID, 'Renamed in CloudCLI');

    assert.equal(
      await readFile(filePath, 'utf8'),
      `${before}\n${customTitleRow('Renamed in CloudCLI', CLI_SESSION_ID)}\n`,
    );
  });
});

test('a rename does not count as activity: the session keeps its place and stays archived', { concurrency: false }, async () => {
  await withClaudeFixture(async ({ projectDir }) => {
    const filePath = await indexCliSession(projectDir);
    sessionsDb.updateSessionIsArchived(CLI_SESSION_ID, true);
    const rowBefore = sessionsDb.getSessionById(CLI_SESSION_ID);

    await sessionsService.renameSessionById(CLI_SESSION_ID, 'Renamed in CloudCLI');
    // What the transcript watcher does when the file changes.
    await new ClaudeSessionSynchronizer().synchronizeFile(filePath);

    assert.equal((await stat(filePath)).mtime.getTime(), OLD_MTIME.getTime());
    const rowAfter = sessionsDb.getSessionById(CLI_SESSION_ID);
    assert.equal(rowAfter?.updated_at, rowBefore?.updated_at);
    assert.equal(rowAfter?.isArchived, 1);
    assert.equal(rowAfter?.custom_name, 'Renamed in CloudCLI');
  });
});

test('a rename with no transcript to write still renames the session', { concurrency: false }, async () => {
  await withClaudeFixture(async ({ projectDir }) => {
    // Never ran: no provider id, no transcript.
    sessionsDb.createAppSession('never-ran', 'claude', PROJECT_PATH, 'Fresh session');
    await sessionsService.renameSessionById('never-ran', 'Renamed before it ran');
    assert.equal(sessionsDb.getSessionById('never-ran')?.custom_name, 'Renamed before it ran');

    // Transcript deleted since it was indexed: it is not brought back.
    const filePath = await indexCliSession(projectDir);
    await unlink(filePath);
    await sessionsService.renameSessionById(CLI_SESSION_ID, 'Renamed after deletion');
    assert.equal(sessionsDb.getSessionById(CLI_SESSION_ID)?.custom_name, 'Renamed after deletion');
    await assert.rejects(stat(filePath), { code: 'ENOENT' });
  });
});

test('a row pointing at a file other than <provider id>.jsonl leaves that file alone', { concurrency: false }, async () => {
  await withClaudeFixture(async ({ projectDir }) => {
    // An older build could index a subagent transcript, which repeats the
    // parent's session id, as the session itself.
    const subagentPath = path.join(projectDir, CLI_SESSION_ID, 'subagents', 'agent-a1.jsonl');
    await mkdir(path.dirname(subagentPath), { recursive: true });
    await writeFile(subagentPath, `${transcriptRows(CLI_SESSION_ID).join('\n')}\n`);
    sessionsDb.createSession(CLI_SESSION_ID, 'claude', PROJECT_PATH, 'Login bug fix', undefined, undefined, subagentPath);
    const before = await readFile(subagentPath, 'utf8');

    await sessionsService.renameSessionById(CLI_SESSION_ID, 'Renamed in CloudCLI');

    assert.equal(sessionsDb.getSessionById(CLI_SESSION_ID)?.custom_name, 'Renamed in CloudCLI');
    assert.equal(await readFile(subagentPath, 'utf8'), before);
  });
});

test('a transcript that cannot be written does not fail the rename', { concurrency: false, skip: process.getuid?.() === 0 }, async () => {
  await withClaudeFixture(async ({ projectDir }) => {
    const filePath = await indexCliSession(projectDir);
    const before = await readFile(filePath, 'utf8');
    await chmod(filePath, 0o444);

    try {
      const result = await sessionsService.renameSessionById(CLI_SESSION_ID, 'Renamed in CloudCLI');
      assert.deepEqual(result, { sessionId: CLI_SESSION_ID, summary: 'Renamed in CloudCLI' });
      assert.equal(sessionsDb.getSessionById(CLI_SESSION_ID)?.custom_name, 'Renamed in CloudCLI');
      assert.equal(await readFile(filePath, 'utf8'), before);
    } finally {
      await chmod(filePath, 0o644);
    }
  });
});

test('renaming a session of another provider leaves its files alone', { concurrency: false }, async () => {
  await withClaudeFixture(async ({ home }) => {
    const rolloutPath = path.join(home, '.codex', 'sessions', 'rollout-codex-native.jsonl');
    await mkdir(path.dirname(rolloutPath), { recursive: true });
    const rollout = `${JSON.stringify({ type: 'session_meta', payload: { id: 'codex-native', cwd: PROJECT_PATH } })}\n`;
    await writeFile(rolloutPath, rollout);
    sessionsDb.createSession('codex-native', 'codex', PROJECT_PATH, 'Codex session', undefined, undefined, rolloutPath);

    await sessionsService.renameSessionById('codex-native', 'Renamed Codex session');

    assert.equal(sessionsDb.getSessionById('codex-native')?.custom_name, 'Renamed Codex session');
    assert.equal(await readFile(rolloutPath, 'utf8'), rollout);

    // A row of a provider CloudCLI has since dropped still renames.
    sessionsDb.createSession('gemini-native', 'gemini', PROJECT_PATH, 'Gemini session');
    await sessionsService.renameSessionById('gemini-native', 'Renamed Gemini session');
    assert.equal(sessionsDb.getSessionById('gemini-native')?.custom_name, 'Renamed Gemini session');
  });
});

test('the title row does not change the conversation history shows', { concurrency: false }, async () => {
  await withClaudeFixture(async ({ projectDir }) => {
    await indexCliSession(projectDir);
    const before = await sessionsService.fetchHistory(CLI_SESSION_ID);

    await sessionsService.renameSessionById(CLI_SESSION_ID, 'Renamed in CloudCLI');

    const after = await sessionsService.fetchHistory(CLI_SESSION_ID);
    assert.equal(before.total, 2);
    assert.deepEqual(
      after.messages.map((message) => [message.kind, message.content]),
      before.messages.map((message) => [message.kind, message.content]),
    );
  });
});
