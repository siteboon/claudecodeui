import assert from 'node:assert/strict';
import test from 'node:test';

import { flattenProjectResults } from './transcriptSearchData';

const mkMatch = (snippet: string, role = 'user') => ({
  role,
  snippet,
  highlights: [] as { start: number; end: number }[],
  timestamp: null as string | null,
});

test('flattenProjectResults: empty input yields empty output', () => {
  assert.deepEqual(flattenProjectResults([]), []);
});

test('flattenProjectResults: one project with one session + one match', () => {
  const out = flattenProjectResults([
    {
      projectName: 'home-user-proj',
      projectDisplayName: 'proj',
      sessions: [
        {
          sessionId: 'abc',
          sessionSummary: 'My session',
          matches: [mkMatch('hello world')],
        },
      ],
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].projectName, 'home-user-proj');
  assert.equal(out[0].projectDisplayName, 'proj');
  assert.equal(out[0].sessionId, 'abc');
  assert.equal(out[0].sessionSummary, 'My session');
  assert.equal(out[0].match.snippet, 'hello world');
});

test('flattenProjectResults: only keeps the first match per session (MVP)', () => {
  const out = flattenProjectResults([
    {
      projectName: 'p',
      projectDisplayName: 'p',
      sessions: [
        {
          sessionId: 's1',
          sessionSummary: 'S1',
          matches: [mkMatch('first'), mkMatch('second'), mkMatch('third')],
        },
      ],
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].match.snippet, 'first');
});

test('flattenProjectResults: drops sessions with no matches', () => {
  const out = flattenProjectResults([
    {
      projectName: 'p',
      projectDisplayName: 'p',
      sessions: [
        { sessionId: 's1', sessionSummary: 'S1', matches: [] },
        { sessionId: 's2', sessionSummary: 'S2', matches: [mkMatch('keep me')] },
      ],
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sessionId, 's2');
});

test('flattenProjectResults: flattens across multiple projects preserving order', () => {
  const out = flattenProjectResults([
    {
      projectName: 'p1',
      projectDisplayName: 'P1',
      sessions: [
        { sessionId: 'a', sessionSummary: 'A', matches: [mkMatch('a1')] },
        { sessionId: 'b', sessionSummary: 'B', matches: [mkMatch('b1')] },
      ],
    },
    {
      projectName: 'p2',
      projectDisplayName: 'P2',
      sessions: [{ sessionId: 'c', sessionSummary: 'C', matches: [mkMatch('c1')] }],
    },
  ]);
  assert.deepEqual(
    out.map((r) => `${r.projectName}:${r.sessionId}`),
    ['p1:a', 'p1:b', 'p2:c'],
  );
});

test('flattenProjectResults: carries projectDisplayName onto each row', () => {
  const out = flattenProjectResults([
    {
      projectName: 'home-user-workspace-long-path',
      projectDisplayName: 'workspace',
      sessions: [{ sessionId: 's', sessionSummary: 'S', matches: [mkMatch('x')] }],
    },
  ]);
  assert.equal(out[0].projectDisplayName, 'workspace');
});
