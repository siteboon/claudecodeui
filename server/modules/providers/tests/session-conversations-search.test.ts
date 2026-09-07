import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import type * as DatabaseModule from '@/modules/database/index.js';
import type { searchConversations as SearchConversations } from '@/modules/providers/services/session-conversations-search.service.js';

const originalDatabasePath = process.env.DATABASE_PATH;
let directory: string;
let database: typeof DatabaseModule;
let searchConversations: typeof SearchConversations;

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'conversation-search-'));
  process.env.DATABASE_PATH = path.join(directory, 'test.db');
  // These modules capture DATABASE_PATH on load, so static imports would open
  // the user's database instead of this isolated fixture.
  database = await import('@/modules/database/index.js');
  await database.initializeDatabase();
  ({ searchConversations } = await import('@/modules/providers/services/session-conversations-search.service.js'));
});

after(async () => {
  database?.closeConnection();
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
  await rm(directory, { recursive: true, force: true });
});

async function addTranscript(provider: 'claude' | 'codex' | 'omp', nativeId: string, entries: unknown[]) {
  const projectPath = path.join(directory, 'username', '.claude', 'projects', 'project-fragment');
  await mkdir(projectPath, { recursive: true });
  const transcriptPath = path.join(projectPath, `${nativeId}.jsonl`);
  await writeFile(transcriptPath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  const sessionId = database.sessionsDb.createSession(
    nativeId, provider, projectPath, 'Conversation', undefined, undefined, transcriptPath,
  );
  return { sessionId, transcriptPath };
}

test('literal checklist conversations survive the prefilter for Claude and Codex', async () => {
  const claude = await addTranscript('claude', 'literal-c', [{
    type: 'user', sessionId: 'literal-c', message: { role: 'user', content: 'release checklist complete' },
  }]);
  const codex = await addTranscript('codex', 'literal-x', [{
    type: 'event_msg', payload: { type: 'user_message', message: 'release checklist complete' },
  }]);

  for (const query of ['checklist', 'release checklist']) {
    const result = await searchConversations(query);
    const matches = result.results.flatMap((project) => project.sessions);
    for (const sessionId of [claude.sessionId, codex.sessionId]) {
      assert.ok(matches.some((session) => session.sessionId === sessionId
        && session.matches.some((match) => match.snippet.includes('release checklist complete'))));
    }
  }
});

test('path-only query hits do not open Claude or Codex transcripts for parsing', async (context) => {
  await addTranscript('claude', 'path-c', [{
    type: 'user', sessionId: 'path-c', message: { role: 'user', content: 'hello' },
  }]);
  await addTranscript('codex', 'path-x', [{
    type: 'event_msg', payload: { type: 'user_message', message: 'hello' },
  }]);
  // ripgrep reads in its child process; createReadStream observes the expensive
  // application-level transcript parsing, not the necessary disk prefilter.
  const readStream = context.mock.method(fs, 'createReadStream');
  for (const query of ['claude', 'projects', 'username', 'project-fragment']) {
    const result = await searchConversations(query);
    assert.equal(result.totalMatches, 0);
  }
  assert.equal(readStream.mock.callCount(), 0);
});

test('OMP rendered tool labels and advisor filename metadata remain searchable', async () => {
  const omp = await addTranscript('omp', 'rich-o', [
    { type: 'session', version: 3, id: 'rich-o', cwd: directory },
    { type: 'message', id: 'tools', timestamp: '2026-07-21T04:00:00.000Z', message: {
      role: 'assistant', content: [
        { type: 'toolCall', id: 'list', name: 'todo', arguments: { todos: [
          { content: 'Ship the release', status: 'pending' },
        ] } },
        { type: 'toolCall', id: 'question', name: 'ask', arguments: { questions: [
          { id: 'choice', question: 'Pick one', options: [{ label: 'Proceed' }] },
        ] } },
      ],
    } },
  ]);
  const sidecarDirectory = omp.transcriptPath.replace(/\.jsonl$/, '');
  await mkdir(sidecarDirectory);
  await writeFile(path.join(sidecarDirectory, '__advisor.luna.jsonl'), JSON.stringify({
    type: 'message', id: 'note', timestamp: '2026-07-21T04:00:01.000Z', message: {
      role: 'assistant', content: [{ type: 'toolCall', id: 'advice', name: 'advise', arguments: {
        note: 'Inspect rollback handling', severity: 'concern',
      } }],
    },
  }) + '\n');

  for (const [query, expected] of [
    ['checklist', 'Checklist'],
    ['todowrite', 'TodoWrite'],
    ['askuserquestion', 'AskUserQuestion'],
    ['advisor luna', 'Advisor luna'],
    ['rollback', 'rollback'],
  ]) {
    const result = await searchConversations(query);
    const session = result.results.flatMap((project) => project.sessions)
      .find((candidate) => candidate.sessionId === omp.sessionId);
    assert.ok(session, `OMP session should match ${query}`);
    assert.ok(session.matches.some((match) => match.snippet.includes(expected)));
  }
});
