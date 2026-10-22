import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { getProjectSessionsPage, getProjectsWithSessions } from '@/modules/projects/services/projects-with-sessions-fetch.service.js';
import { sessionsService } from '@/modules/providers/index.js';

const PROJECT_PATH = '/workspace/fork-tree';

async function withDatabase(run: () => Promise<void>) {
  const previousPath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'project-session-forks-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  try {
    await initializeDatabase();
    await run();
  } finally {
    closeConnection();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
}

function seedFork(id: string, parent: string, projectPath = PROJECT_PATH, provider = 'claude') {
  sessionsDb.createForkedSession({
    sessionId: id,
    provider,
    projectPath,
    customName: id,
    providerSessionId: `native-${id}`,
    jsonlPath: `/transcripts/${id}.jsonl`,
    forkedFromSessionId: parent,
    model: null,
    effort: null,
  });
}

test('project pages expose app-id ancestry without advancing pagination or changing the Conversations feed', async () => {
  await withDatabase(async () => {
    sessionsDb.createAppSession('parent', 'claude', PROJECT_PATH, 'Original');
    sessionsDb.assignProviderSessionId('parent', 'native-parent');
    seedFork('child', 'parent');
    seedFork('grandchild', 'child');
    for (const [index, id] of ['parent', 'child', 'grandchild'].entries()) {
      getConnection().prepare('UPDATE sessions SET updated_at = ? WHERE session_id = ?')
        .run(`2026-10-18T0${index}:00:00.000Z`, id);
    }

    const [project] = await getProjectsWithSessions({ skipSynchronization: true, sessionsLimit: 1 });
    assert.deepEqual(project.sessions.map((session) => session.id), ['grandchild']);
    assert.deepEqual(project.sessionMeta, { total: 3, hasMore: true });
    assert.equal(project.sessions[0].forkedFromSessionId, 'child');
    assert.deepEqual(project.sessions[0].forkAncestors.map((ancestor) => ancestor.id).sort(), ['child', 'parent']);
    assert.equal(project.sessions[0].forkAncestors.find((ancestor) => ancestor.id === 'child')?.forkedFromSessionId, 'parent');

    const next = await getProjectSessionsPage(project.projectId, { limit: 1, offset: 1 });
    assert.deepEqual(next.sessions.map((session) => session.id), ['child']);
    assert.equal(next.sessions[0].forkAncestors[0].id, 'parent');
    const last = await getProjectSessionsPage(project.projectId, { limit: 1, offset: 2 });
    assert.deepEqual(last.sessions.map((session) => session.id), ['parent']);
    assert.deepEqual(last.sessions[0].forkAncestors, []);
    assert.equal(last.sessionMeta.hasMore, false);

    const recent = sessionsService.listRecentSessions(20, 0);
    assert.deepEqual(recent.conversations.map((conversation) => conversation.sessionId), ['grandchild', 'child', 'parent']);
    assert.ok(recent.conversations.every((conversation) => !('forkAncestors' in conversation)));
  });
});

test('archiving or deleting a parent keeps independent children and stops ancestor context at the gap', async () => {
  await withDatabase(async () => {
    sessionsDb.createAppSession('root', 'claude', PROJECT_PATH, 'Root');
    seedFork('middle', 'root');
    seedFork('leaf', 'middle');
    sessionsDb.updateSessionIsArchived('middle', true);
    assert.deepEqual(sessionsDb.getForkAncestors('leaf'), []);
    assert.ok(sessionsDb.getSessionById('leaf'));
    getConnection().prepare('DELETE FROM sessions WHERE session_id = ?').run('middle');
    assert.deepEqual(sessionsDb.getForkAncestors('leaf'), []);
    const project = projectsDb.getProjectPath(PROJECT_PATH)!;
    const page = await getProjectSessionsPage(project.project_id);
    assert.deepEqual(page.sessions.map((session) => session.id).sort(), ['leaf', 'root']);
  });
});

test('ancestor context cannot cross project or provider boundaries and remains finite for cycles', async () => {
  await withDatabase(async () => {
    sessionsDb.createAppSession('root', 'claude', PROJECT_PATH);
    seedFork('different-project', 'root', '/workspace/elsewhere');
    seedFork('different-provider', 'root', PROJECT_PATH, 'codex');
    assert.deepEqual(sessionsDb.getForkAncestors('different-project'), []);
    assert.deepEqual(sessionsDb.getForkAncestors('different-provider'), []);

    seedFork('cycle-a', 'cycle-b');
    seedFork('cycle-b', 'cycle-a');
    assert.deepEqual(sessionsDb.getForkAncestors('cycle-a').map((ancestor) => ancestor.id), ['cycle-b']);
    assert.deepEqual(sessionsDb.getForkAncestors('missing'), []);
  });
});
