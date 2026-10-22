import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

async function withDatabase(runTest: (directory: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  // Resolved so the Claude folder name matches what the move encodes.
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'session-move-')));

  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest(directory);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

function createTargetProject(projectPath: string): string {
  const created = projectsDb.createProjectPath(projectPath);
  assert.ok(created.project);
  return created.project.project_id;
}

test('a Claude session is refiled under the target project folder with its cwd rewritten', async () => {
  await withDatabase(async (directory) => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'target');
    await mkdir(source);
    await mkdir(target);

    const projectsRoot = path.join(directory, 'claude', 'projects');
    const sourceFolder = path.join(projectsRoot, source.replace(/[^a-zA-Z0-9]/g, '-'));
    const transcript = path.join(sourceFolder, 'claude-native.jsonl');
    await mkdir(path.join(sourceFolder, 'claude-native', 'subagents'), { recursive: true });
    await writeFile(path.join(sourceFolder, 'claude-native', 'subagents', 'agent-1.jsonl'), '{}\n');
    const untouchedLine = '{"type":"summary","summary":"no cwd here"}';
    await writeFile(transcript, [
      JSON.stringify({ type: 'user', sessionId: 'claude-native', cwd: source, message: { role: 'user', content: 'hi' } }),
      untouchedLine,
      'not json "cwd"',
      JSON.stringify({ type: 'assistant', sessionId: 'claude-native', cwd: '/elsewhere' }),
      '',
    ].join('\n'));

    const now = new Date().toISOString();
    sessionsDb.createSession('claude-native', 'claude', source, 'Claude chat', now, now, transcript);
    const targetId = createTargetProject(target);

    const result = await sessionsService.moveSessionToProject('claude-native', targetId);
    assert.equal(result.projectId, targetId);

    const targetFolder = path.join(projectsRoot, target.replace(/[^a-zA-Z0-9]/g, '-'));
    const movedTranscript = path.join(targetFolder, 'claude-native.jsonl');
    const lines = (await readFile(movedTranscript, 'utf8')).split('\n');
    assert.equal(JSON.parse(lines[0]).cwd, target);
    assert.equal(lines[1], untouchedLine);
    assert.equal(lines[2], 'not json "cwd"');
    assert.equal(JSON.parse(lines[3]).cwd, '/elsewhere', 'a cwd the session moved away from inside the chat is kept');

    assert.equal(await exists(transcript), false, 'the old transcript would be indexed back into the old project');
    assert.equal(await exists(path.join(targetFolder, 'claude-native', 'subagents', 'agent-1.jsonl')), true);

    const row = sessionsDb.getSessionById('claude-native');
    assert.equal(row?.project_path, target);
    assert.equal(row?.jsonl_path, movedTranscript);
  });
});

test('a Codex session is rewritten in place', async () => {
  await withDatabase(async (directory) => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'target');
    const transcript = path.join(directory, 'rollout.jsonl');
    await writeFile(transcript, [
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-native', cwd: source } }),
      JSON.stringify({ type: 'turn_context', payload: { cwd: source, model: 'gpt' } }),
      JSON.stringify({ type: 'turn_context', payload: { cwd: path.join(source, 'packages', 'api') } }),
    ].join('\n'));

    const now = new Date().toISOString();
    sessionsDb.createSession('codex-native', 'codex', source, 'Codex chat', now, now, transcript);
    const targetId = createTargetProject(target);

    await sessionsService.moveSessionToProject('codex-native', targetId);

    const rows = (await readFile(transcript, 'utf8')).split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(
      rows.map((row) => row.payload.cwd),
      [target, target, path.join(target, 'packages', 'api')],
      'a subdirectory of the project follows it',
    );
    assert.equal(sessionsDb.getSessionById('codex-native')?.project_path, target);
  });
});

test('a session that has not run moves for any provider; one with a transcript needs provider support', async () => {
  await withDatabase(async (directory) => {
    const source = path.join(directory, 'source');
    const targetId = createTargetProject(path.join(directory, 'target'));

    sessionsDb.createAppSession('fresh', 'opencode', source, 'Fresh');
    await sessionsService.moveSessionToProject('fresh', targetId);
    assert.equal(sessionsDb.getSessionById('fresh')?.project_path, path.join(directory, 'target'));

    sessionsDb.createSession('opencode-native', 'opencode', source, 'Ran already');
    await assert.rejects(
      () => sessionsService.moveSessionToProject('opencode-native', targetId),
      (error: { code?: string }) => error.code === 'SESSION_MOVE_NOT_SUPPORTED',
    );
    await assert.rejects(
      () => sessionsService.moveSessionToProject('fresh', targetId),
      (error: { code?: string }) => error.code === 'SESSION_ALREADY_IN_PROJECT',
    );
  });
});

test('a Codex rollout that cannot be rewritten leaves the session where it was', async () => {
  await withDatabase(async (directory) => {
    const source = path.join(directory, 'source');
    const targetId = createTargetProject(path.join(directory, 'target'));
    const now = new Date().toISOString();
    sessionsDb.createSession('codex-gone', 'codex', source, 'Gone', now, now, path.join(directory, 'missing.jsonl'));

    await assert.rejects(
      () => sessionsService.moveSessionToProject('codex-gone', targetId),
      (error: { code?: string }) => error.code === 'SESSION_MOVE_NOT_SUPPORTED',
    );
    assert.equal(sessionsDb.getSessionById('codex-gone')?.project_path, source);
  });
});

test('a failed transcript-path write moves the rollout back and restores the row', async () => {
  await withDatabase(async (directory) => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'target');
    const transcript = path.join(directory, 'rollout-rollback.jsonl');
    await writeFile(transcript, JSON.stringify({ type: 'session_meta', payload: { id: 'codex-rb', cwd: source } }));
    const now = new Date().toISOString();
    sessionsDb.createSession('codex-rb', 'codex', source, 'Rollback', now, now, transcript);
    const targetId = createTargetProject(target);

    const realUpdate = sessionsDb.updateSessionTranscriptPath;
    sessionsDb.updateSessionTranscriptPath = () => {
      throw new Error('disk full');
    };
    try {
      await assert.rejects(() => sessionsService.moveSessionToProject('codex-rb', targetId), /disk full/);
    } finally {
      sessionsDb.updateSessionTranscriptPath = realUpdate;
    }

    assert.equal(JSON.parse(await readFile(transcript, 'utf8')).payload.cwd, source);
    assert.equal(sessionsDb.getSessionById('codex-rb')?.project_path, source);
  });
});
