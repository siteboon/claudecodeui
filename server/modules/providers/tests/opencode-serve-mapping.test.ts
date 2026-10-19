import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  mapOpenCodeEventToRunJson,
  matchesOpenCodeWildcard,
} from '@/modules/providers/list/opencode/opencode-serve.runtime.js';
import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';
import type { AnyRecord } from '@/shared/types.js';

/**
 * The serve runtime hands OpenCode's server events to the same
 * `normalizeMessage` that read `opencode run --format json` lines before, so
 * the mapping must produce exactly those lines (#1569).
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const sessionsProvider = new OpenCodeSessionsProvider();

test('server events map onto exactly the JSON lines `opencode run --format json` prints', async () => {
  const readJsonLines = async (file: string) => (await readFile(path.join(FIXTURES_DIR, file), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AnyRecord);
  // Recorded from OpenCode 1.18.25: the server's events for an approved bash
  // call followed by a text reply, and what `opencode run --format json --auto`
  // printed for the same kind of turn.
  const serverEvents = await readJsonLines('opencode-serve-events.bash-once.jsonl');
  const runLines = await readJsonLines('opencode-run-lines.bash-auto.jsonl');
  const mainSessionId = serverEvents.find((event) => event.type === 'session.created')?.properties.info.id as string;

  const mapped = serverEvents
    .map((event) => ({ event, line: mapOpenCodeEventToRunJson(event.type, event.properties, mainSessionId) }))
    .filter((entry): entry is { event: AnyRecord; line: AnyRecord } => entry.line !== null);

  assert.deepEqual(mapped.map((entry) => entry.line.type), runLines.map((line) => line.type));
  for (const [index, { event, line }] of mapped.entries()) {
    assert.deepEqual(Object.keys(line).sort(), Object.keys(runLines[index]).sort());
    assert.equal(line.sessionID, mainSessionId);
    assert.equal(typeof line.timestamp, 'number');
    assert.deepEqual(line.part, event.properties.part, 'parts pass through untouched');
  }

  const describe = (lines: AnyRecord[], sessionId: string) => lines.flatMap((line) =>
    sessionsProvider.normalizeMessage(line, sessionId).map((message) => ({
      kind: message.kind,
      role: message.role,
      toolName: message.toolName,
      isError: message.toolResult?.isError,
    })));
  assert.deepEqual(
    describe(mapped.map((entry) => entry.line), mainSessionId),
    describe(runLines, runLines[0].sessionID as string),
  );

  // Session errors become run's `error` line; other sessions and deltas do not.
  const sessionError = { sessionID: mainSessionId, error: { name: 'APIError', data: { message: 'boom' } } };
  assert.deepEqual(
    { ...mapOpenCodeEventToRunJson('session.error', sessionError, mainSessionId), timestamp: 0 },
    { type: 'error', timestamp: 0, sessionID: mainSessionId, error: sessionError.error },
  );
  assert.equal(mapOpenCodeEventToRunJson('session.error', { ...sessionError, sessionID: 'ses_other' }, mainSessionId), null);
  assert.equal(mapOpenCodeEventToRunJson('message.part.delta', { delta: 'x' }, mainSessionId), null);
});

test('remembered approvals match the way OpenCode matches its own patterns', () => {
  assert.equal(matchesOpenCodeWildcard('printf hi', 'printf *'), true);
  assert.equal(matchesOpenCodeWildcard('printf', 'printf *'), true, 'a trailing " *" also covers the bare command');
  assert.equal(matchesOpenCodeWildcard('printfx', 'printf *'), false);
  assert.equal(matchesOpenCodeWildcard('git status', 'git st?tus'), true);
  assert.equal(matchesOpenCodeWildcard('/repo/a.(1).txt', '/repo/*.txt'), true, 'regex characters are literal');
  assert.equal(matchesOpenCodeWildcard('C:\\repo\\a.txt', 'C:/repo/*'), true, 'backslashes compare as slashes');
});
