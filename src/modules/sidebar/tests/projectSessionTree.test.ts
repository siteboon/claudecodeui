import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { SessionWithProvider } from '@/shared/types';
import { buildProjectSessionTree } from '@/modules/sidebar/utils/projectSessionTree';

const session = (id: string, parent: string | null = null, overrides: Partial<SessionWithProvider> = {}): SessionWithProvider => ({
  id, summary: id, __provider: 'claude', forkedFromSessionId: parent, ...overrides,
});
const shape = (sessions: SessionWithProvider[]) => buildProjectSessionTree(sessions, 'project').map((row) => (
  [row.session.id, row.parentId, row.depth, row.hasChildren]
));

test('a family follows its newest descendant, with parents first and siblings in recency order', () => {
  assert.deepEqual(shape([
    session('grandchild', 'older-child'), session('unrelated'), session('newer-child', 'root'),
    session('older-child', 'root'), session('root'),
  ]), [
    ['root', null, 0, true], ['older-child', 'root', 1, true], ['grandchild', 'older-child', 2, false],
    ['newer-child', 'root', 1, false], ['unrelated', null, 0, false],
  ]);
});

test('off-page ancestors provide context without duplicating loaded rows or replacing their current titles', () => {
  const child = session('child', 'parent', { forkAncestors: [session('parent', 'root'), session('root')] });
  const rows = buildProjectSessionTree([child, session('parent', 'root', { summary: 'Renamed parent' })], 'project');
  assert.deepEqual(rows.map((row) => row.session.id), ['root', 'parent', 'child']);
  assert.equal(rows[1].session.summary, 'Renamed parent');
  assert.equal(rows[0].session.__projectId, 'project');
  assert.deepEqual(child.forkAncestors?.map((ancestor) => ancestor.summary), ['parent', 'root']);
});

test('missing parents, self links, provider mismatches and cycles never hide or duplicate a session', () => {
  const rows = buildProjectSessionTree([
    session('orphan', 'missing', { forkAncestors: [session('disconnected')] }),
    session('self', 'self'), session('a', 'b'), session('b', 'a'),
    session('codex', 'a', { __provider: 'codex' }),
  ], 'project');
  assert.deepEqual(rows.map((row) => row.session.id).sort(), ['a', 'b', 'codex', 'orphan', 'self']);
  assert.equal(rows.find((row) => row.session.id === 'orphan')?.depth, 0);
  assert.equal(rows.find((row) => row.session.id === 'self')?.depth, 0);
  assert.equal(rows.find((row) => row.session.id === 'codex')?.depth, 0);
});

test('unrelated sessions preserve flat order and object identities', () => {
  const input = [session('first'), session('second')];
  const rows = buildProjectSessionTree(input, 'project');
  assert.deepEqual(rows.map((row) => row.session), input);
  assert.equal(rows[0].session, input[0]);
  assert.ok(rows.every((row) => row.depth === 0 && !row.hasChildren));
});

test('deep fork chains are projected without recursive stack overflow', () => {
  const input = Array.from({ length: 5000 }, (_, index) => session(`s${index}`, index ? `s${index - 1}` : null)).reverse();
  const rows = buildProjectSessionTree(input, 'project');
  assert.equal(rows.length, input.length);
  assert.equal(rows[0].session.id, 's0');
  assert.equal(rows.at(-1)?.depth, 4999);
});
