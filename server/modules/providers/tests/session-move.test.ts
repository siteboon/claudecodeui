import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
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
      [target, target, path.join(source, 'packages', 'api')],
      'only the project folder itself is swapped; a subdirectory has no counterpart in the target',
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
    assert.equal(sessionsDb.getSessionById('codex-rb')?.jsonl_path, transcript);
  });
});

test('when a Codex rollout cannot be moved back either, the move completes in the target project', async () => {
  await withDatabase(async (directory) => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'target');
    const transcript = path.join(directory, 'rollout-stuck.jsonl');
    await writeFile(transcript, JSON.stringify({ type: 'session_meta', payload: { id: 'codex-stuck', cwd: source } }));
    const now = new Date().toISOString();
    sessionsDb.createSession('codex-stuck', 'codex', source, 'Stuck', now, now, transcript);
    const targetId = createTargetProject(target);

    const facet = providerRegistry.resolveProvider('codex').transcriptRelocation!;
    const realRelocate = facet.relocateTranscripts.bind(facet);
    assert.equal(Object.hasOwn(facet, 'relocateTranscripts'), false);
    let calls = 0;
    facet.relocateTranscripts = async (input) => {
      calls += 1;
      if (calls > 1) throw new Error('cannot move back');
      return realRelocate(input);
    };
    const realUpdate = sessionsDb.updateSessionTranscriptPath;
    sessionsDb.updateSessionTranscriptPath = () => {
      throw new Error('disk full');
    };
    try {
      // The rollout is rewritten in place, so the row already matches it.
      await sessionsService.moveSessionToProject('codex-stuck', targetId);
    } finally {
      sessionsDb.updateSessionTranscriptPath = realUpdate;
      // Drop the own-property override so the class method shows through again.
      delete (facet as { relocateTranscripts?: unknown }).relocateTranscripts;
    }

    assert.equal(JSON.parse(await readFile(transcript, 'utf8')).payload.cwd, target);
    assert.equal(sessionsDb.getSessionById('codex-stuck')?.project_path, target, 'the row follows the file, not the plan');
    assert.equal(calls, 2, 'the move-back was attempted');
    assert.equal(sessionsDb.getSessionById('codex-stuck')?.jsonl_path, transcript);
  });
});

test('a Claude move whose transcript path cannot be saved puts the file back in the source folder', async () => {
  await withDatabase(async (directory) => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'target');
    await mkdir(source);
    await mkdir(target);
    const projectsRoot = path.join(directory, 'claude', 'projects');
    const sourceFolder = path.join(projectsRoot, source.replace(/[^a-zA-Z0-9]/g, '-'));
    const transcript = path.join(sourceFolder, 'claude-rb.jsonl');
    await mkdir(sourceFolder, { recursive: true });
    await writeFile(transcript, `${JSON.stringify({ type: 'user', sessionId: 'claude-rb', cwd: source })}\n`);
    const now = new Date().toISOString();
    sessionsDb.createSession('claude-rb', 'claude', source, 'Claude rollback', now, now, transcript);
    const targetId = createTargetProject(target);

    const realUpdate = sessionsDb.updateSessionTranscriptPath;
    let failed = false;
    sessionsDb.updateSessionTranscriptPath = (...args) => {
      // The forward write lands and then reports failure, as if the watcher had
      // already repointed the row at the moved copy; the restore must undo it.
      realUpdate(...args);
      if (!failed) {
        failed = true;
        throw new Error('disk full');
      }
    };
    try {
      await assert.rejects(() => sessionsService.moveSessionToProject('claude-rb', targetId), /disk full/);
    } finally {
      sessionsDb.updateSessionTranscriptPath = realUpdate;
    }

    const targetCopy = path.join(projectsRoot, target.replace(/[^a-zA-Z0-9]/g, '-'), 'claude-rb.jsonl');
    assert.equal(await exists(targetCopy), false);
    assert.equal(JSON.parse((await readFile(transcript, 'utf8')).split('\n')[0]).cwd, source);
    const row = sessionsDb.getSessionById('claude-rb');
    assert.equal(row?.project_path, source);
    assert.equal(row?.jsonl_path, transcript);
  });
});

test('a Claude move that cannot be undone leaves the row on the moved copy', async () => {
  await withDatabase(async (directory) => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'target');
    await mkdir(source);
    await mkdir(target);
    const projectsRoot = path.join(directory, 'claude', 'projects');
    const sourceFolder = path.join(projectsRoot, source.replace(/[^a-zA-Z0-9]/g, '-'));
    const transcript = path.join(sourceFolder, 'claude-stuck.jsonl');
    await mkdir(sourceFolder, { recursive: true });
    await writeFile(transcript, `${JSON.stringify({ type: 'user', sessionId: 'claude-stuck', cwd: source })}\n`);
    const now = new Date().toISOString();
    sessionsDb.createSession('claude-stuck', 'claude', source, 'Claude stuck', now, now, transcript);
    const targetId = createTargetProject(target);

    const facet = providerRegistry.resolveProvider('claude').transcriptRelocation!;
    assert.equal(Object.hasOwn(facet, 'relocateTranscripts'), false);
    const realRelocate = facet.relocateTranscripts.bind(facet);
    let relocateCalls = 0;
    facet.relocateTranscripts = async (input) => {
      relocateCalls += 1;
      if (relocateCalls > 1) throw new Error('cannot move back');
      return realRelocate(input);
    };
    const realUpdate = sessionsDb.updateSessionTranscriptPath;
    let updateCalls = 0;
    sessionsDb.updateSessionTranscriptPath = (...args) => {
      updateCalls += 1;
      // Only the first (forward) write fails: the retry after a failed move-back gets through.
      if (updateCalls === 1) throw new Error('database busy');
      return realUpdate(...args);
    };
    try {
      // The retried write gets through, so the row matches the moved copy and the move completes.
      await sessionsService.moveSessionToProject('claude-stuck', targetId);
    } finally {
      sessionsDb.updateSessionTranscriptPath = realUpdate;
      delete (facet as { relocateTranscripts?: unknown }).relocateTranscripts;
    }

    const movedCopy = path.join(projectsRoot, target.replace(/[^a-zA-Z0-9]/g, '-'), 'claude-stuck.jsonl');
    assert.equal(await exists(movedCopy), true);
    const row = sessionsDb.getSessionById('claude-stuck');
    assert.equal(row?.project_path, target);
    assert.equal(row?.jsonl_path, movedCopy, 'the row must not name the deleted source file');
    assert.equal(relocateCalls, 2, 'the move-back was attempted');
    assert.equal(updateCalls, 2, 'the transcript path write was retried');
  });
});
