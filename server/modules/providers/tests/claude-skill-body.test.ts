import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const provider = new ClaudeSessionsProvider();
const SESSION_ID = 'claude-skill-body-1';

const userTurn = (extra: Record<string, unknown>, text: string) => ({
  type: 'user',
  uuid: 'u-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  message: { role: 'user', content: [{ type: 'text', text }] },
  ...extra,
});

/**
 * Invoking a skill injects the whole SKILL.md as a synthetic user turn. It used
 * to be recognised by the prefix `Base directory for this skill:`, which only
 * skills with a base directory emit — so the two below rendered in full, as
 * bubbles of 16,966 and 3,619 characters, in session `981b3310`.
 *
 * Both openings are verbatim from that transcript.
 */
test('a skill body with no base-directory line is hidden on the live stream', () => {
  const rows = provider.normalizeMessage(
    userTurn({ isSynthetic: true }, '# Workflow authoring reference\n\nA workflow structures work…'),
    SESSION_ID,
  );

  assert.deepEqual(rows, []);
});

test('a skill body with no base-directory line is hidden in a persisted transcript', () => {
  const rows = provider.normalizeMessage(
    userTurn(
      { sourceToolUseID: 'toolu_01Mq7Mpy2Kkwo1yKW71m2vFu', turnCompanion: true },
      'Draw as the engineer who has to live with the decision, not as a decorator…',
    ),
    SESSION_ID,
  );

  assert.deepEqual(rows, []);
});

/** The case that already worked — the marker must not regress it. */
test('a skill body that does open with the base-directory line stays hidden', () => {
  const rows = provider.normalizeMessage(
    userTurn({ isSynthetic: true }, 'Base directory for this skill: /tmp/skills/claude-api\n\n# Building…'),
    SESSION_ID,
  );

  assert.deepEqual(rows, []);
});

/**
 * The whole point of matching the marker instead of the prose: a real prompt
 * may legitimately start with anything, including the text of a skill someone
 * is discussing.
 */
test('a real user turn carrying no marker is kept', () => {
  const [row, ...rest] = provider.normalizeMessage(
    userTurn({}, '# Workflow authoring reference\n\nA workflow structures work…'),
    SESSION_ID,
  );

  assert.equal(rest.length, 0);
  assert.equal(row.kind, 'text');
  assert.equal(row.role, 'user');
  assert.equal(row.content, '# Workflow authoring reference\n\nA workflow structures work…');
});

/**
 * The `tool_result` frame for the `Skill` call arrives immediately before the
 * body and carries no `isSynthetic` — verified on `claude` 2.1.272. Guarding
 * only the text branches keeps it flowing even if a future shape marks the row.
 */
test('a tool result on an injected turn is still emitted', () => {
  const rows = provider.normalizeMessage({
    type: 'user',
    uuid: 'u-2',
    timestamp: '2026-01-01T00:00:00.000Z',
    isSynthetic: true,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'PROBEOK' }],
    },
  }, SESSION_ID);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'tool_result');
  assert.equal(rows[0].toolId, 'toolu_1');
});

/** A string payload takes a different branch in `normalizeMessage`. */
test('a string-payload injected turn is hidden too', () => {
  const rows = provider.normalizeMessage({
    type: 'user',
    uuid: 'u-3',
    timestamp: '2026-01-01T00:00:00.000Z',
    isSynthetic: true,
    message: { role: 'user', content: '# Workflow authoring reference\n\nA workflow…' },
  }, SESSION_ID);

  assert.deepEqual(rows, []);
});
