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
    const getConnectionModule = await import('@/modules/database/connection.js');
    getConnectionModule.getConnection()
      .prepare("UPDATE sessions SET updated_at = '2020-01-01 00:00:00' WHERE session_id = 'fresh'")
      .run();
    await sessionsService.moveSessionToProject('fresh', targetId);
    const moved = sessionsDb.getSessionById('fresh');
    assert.equal(moved?.project_path, path.join(directory, 'target'));
    // Clients list a moved session first in its new project; paging must agree.
    assert.ok(new Date(moved?.updated_at ?? 0).getFullYear() > 2020, 'a move bumps updated_at');

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
    // An old timestamp, so a wrong bump cannot coincide with it.
    (await import('@/modules/database/connection.js')).getConnection()
      .prepare("UPDATE sessions SET updated_at = '2020-01-01 00:00:00' WHERE session_id = 'codex-gone'")
      .run();
    const updatedBefore = sessionsDb.getSessionById('codex-gone')?.updated_at;

    await assert.rejects(
      () => sessionsService.moveSessionToProject('codex-gone', targetId),
      (error: { code?: string }) => error.code === 'SESSION_MOVE_NOT_SUPPORTED',
    );
    assert.equal(sessionsDb.getSessionById('codex-gone')?.project_path, source);
    assert.equal(sessionsDb.getSessionById('codex-gone')?.updated_at, updatedBefore, 'a failed move keeps its order');
  });
});

test('a Codex move does not depend on the transcript-path write, which has nothing to change', async () => {
  await withDatabase(async (directory) => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'target');
    const transcript = path.join(directory, 'rollout-same-path.jsonl');
    await writeFile(transcript, JSON.stringify({ type: 'session_meta', payload: { id: 'codex-same', cwd: source } }));
    const now = new Date().toISOString();
    sessionsDb.createSession('codex-same', 'codex', source, 'Same path', now, now, transcript);
    const targetId = createTargetProject(target);

    const realUpdate = sessionsDb.updateSessionTranscriptPath;
    sessionsDb.updateSessionTranscriptPath = () => {
      throw new Error('must not be called');
    };
    try {
      await sessionsService.moveSessionToProject('codex-same', targetId);
    } finally {
      sessionsDb.updateSessionTranscriptPath = realUpdate;
    }

    assert.equal(JSON.parse(await readFile(transcript, 'utf8')).payload.cwd, target);
    const row = sessionsDb.getSessionById('codex-same');
    assert.equal(row?.project_path, target);
    assert.equal(row?.jsonl_path, transcript);
  });
});

async function seedClaudeSession(directory: string, id: string) {
  const source = path.join(directory, 'source');
  const target = path.join(directory, 'target');
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  const projectsRoot = path.join(directory, 'claude', 'projects');
  const sourceFolder = path.join(projectsRoot, source.replace(/[^a-zA-Z0-9]/g, '-'));
  const transcript = path.join(sourceFolder, `${id}.jsonl`);
  await mkdir(sourceFolder, { recursive: true });
  await writeFile(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd: source })}\n`);
  const now = new Date().toISOString();
  sessionsDb.createSession(id, 'claude', source, 'Claude session', now, now, transcript);
  return {
    source,
    target,
    transcript,
    movedCopy: path.join(projectsRoot, target.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`),
    targetId: createTargetProject(target),
  };
}

/** Fails the first `failures` transcript-path writes; `landFirst` persists each one before throwing, as if the watcher had repointed the row. */
function failTranscriptPathWrites(failures: number, landFirst = false) {
  const realUpdate = sessionsDb.updateSessionTranscriptPath;
  let calls = 0;
  sessionsDb.updateSessionTranscriptPath = (...args) => {
    calls += 1;
    if (calls <= failures) {
      if (landFirst) realUpdate(...args);
      throw new Error('database busy');
    }
    return realUpdate(...args);
  };
  return {
    calls: () => calls,
    restore: () => {
      sessionsDb.updateSessionTranscriptPath = realUpdate;
    },
  };
}

test('a transient transcript-path failure is retried before anything is moved back', async () => {
  await withDatabase(async (directory) => {
    const { target, transcript, movedCopy, targetId } = await seedClaudeSession(directory, 'claude-retry');
    const writes = failTranscriptPathWrites(1);
    try {
      await sessionsService.moveSessionToProject('claude-retry', targetId);
    } finally {
      writes.restore();
    }

    assert.equal(writes.calls(), 2, 'the write was retried');
    assert.equal(await exists(transcript), false);
    const row = sessionsDb.getSessionById('claude-retry');
    assert.equal(row?.project_path, target);
    assert.equal(row?.jsonl_path, movedCopy);
  });
});

test('a Claude move whose transcript path cannot be saved puts the file back and restores the row', async () => {
  await withDatabase(async (directory) => {
    const { source, transcript, movedCopy, targetId } = await seedClaudeSession(directory, 'claude-rb');
    // Both forward attempts land and then fail, so the restore has to undo them.
    const writes = failTranscriptPathWrites(2, true);
    try {
      await assert.rejects(
        () => sessionsService.moveSessionToProject('claude-rb', targetId),
        (error: { code?: string; statusCode?: number }) => error.code === 'SESSION_MOVE_FAILED' && error.statusCode === 500,
      );
    } finally {
      writes.restore();
    }
    // The injected write failure is what rolled the move back; the jsonl_path
    // check below is what proves the restore ran (the failed writes landed first).
    assert.ok(writes.calls() >= 2, 'the path write failed and was retried before the rollback');

    assert.equal(await exists(movedCopy), false);
    assert.equal(JSON.parse((await readFile(transcript, 'utf8')).split('\n')[0]).cwd, source);
    const row = sessionsDb.getSessionById('claude-rb');
    assert.equal(row?.project_path, source);
    assert.equal(row?.jsonl_path, transcript);
  });
});

for (const failure of ['skips the file', 'throws'] as const) test(`a Claude move that can neither be saved nor undone (move-back ${failure}) reports it as moved, with a warning`, async () => {
  await withDatabase(async (directory) => {
    const { target, transcript, movedCopy, targetId } = await seedClaudeSession(directory, 'claude-stuck');
    const facet = providerRegistry.resolveProvider('claude').transcriptRelocation!;
    assert.equal(Object.hasOwn(facet, 'relocateTranscripts'), false);
    const realRelocate = facet.relocateTranscripts.bind(facet);
    let relocateCalls = 0;
    // The real facet reports a transcript it cannot place by leaving it out, not by throwing.
    facet.relocateTranscripts = async (input) => {
      relocateCalls += 1;
      if (relocateCalls === 1) return realRelocate(input);
      if (failure === 'throws') throw new Error('cannot move back');
      return [];
    };
    const writes = failTranscriptPathWrites(Number.POSITIVE_INFINITY);
    let result: Awaited<ReturnType<typeof sessionsService.moveSessionToProject>> | undefined;
    try {
      // The session did move, so the client must treat it as moved.
      result = await sessionsService.moveSessionToProject('claude-stuck', targetId);
    } finally {
      writes.restore();
      delete (facet as { relocateTranscripts?: unknown }).relocateTranscripts;
    }

    assert.equal(relocateCalls, 2, 'the move-back was attempted');
    assert.equal(await exists(movedCopy), true);
    assert.equal(result?.projectId, targetId);
    assert.equal(result?.warning, 'SESSION_MOVE_TRANSCRIPT_PENDING');
    assert.equal(await exists(transcript), false);
    const row = sessionsDb.getSessionById('claude-stuck');
    assert.equal(row?.project_path, target, 'the row stays where the file is');
    // Not saved yet; the watcher repoints it once it indexes the moved copy.
    assert.equal(row?.jsonl_path, transcript);
  });
});
