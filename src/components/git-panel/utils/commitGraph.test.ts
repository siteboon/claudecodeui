import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCommitGraph } from './commitGraph';

test('linear history stays in a single lane', () => {
  const rows = computeCommitGraph([
    { hash: 'c3', parents: ['c2'] },
    { hash: 'c2', parents: ['c1'] },
    { hash: 'c1', parents: [] },
  ]);

  assert.deepEqual(rows.map((row) => row.nodeLane), [0, 0, 0]);
  assert.deepEqual(rows.map((row) => row.laneCount), [1, 1, 1]);
  // Tip has no line from above; root has no line below.
  assert.equal(rows[0].hasTopContinuation, false);
  assert.equal(rows[0].hasParentContinuation, true);
  assert.equal(rows[2].hasParentContinuation, false);
  assert.deepEqual(rows[1].passThrough, []);
});

test('merge commit opens a second lane that joins back at the fork point', () => {
  // main:    m2 --- m1 --- base
  // feature:     \- f1 -/     (m2 merges f1; both branch from base)
  const rows = computeCommitGraph([
    { hash: 'm2', parents: ['m1', 'f1'] },
    { hash: 'm1', parents: ['base'] },
    { hash: 'f1', parents: ['base'] },
    { hash: 'base', parents: [] },
  ]);

  // Merge commit sits in lane 0 and branches a line out to lane 1.
  assert.equal(rows[0].nodeLane, 0);
  assert.deepEqual(rows[0].outbound, [1]);
  assert.equal(rows[0].laneCount, 2);

  // m1 passes lane 1 (feature line) straight through.
  assert.equal(rows[1].nodeLane, 0);
  assert.deepEqual(rows[1].passThrough, [1]);

  // f1 is the feature commit in lane 1; lane 0 (main) passes through.
  assert.equal(rows[2].nodeLane, 1);
  assert.deepEqual(rows[2].passThrough, [0]);

  // base: both lanes converge — lane 1 merges into the node in lane 0.
  assert.equal(rows[3].nodeLane, 0);
  assert.deepEqual(rows[3].inbound, [1]);
  assert.deepEqual(rows[3].bottomLanes, []);
});

test('independent branch tips get their own lanes', () => {
  // Two branch tips pointing at the same parent (e.g. main and a feature).
  const rows = computeCommitGraph([
    { hash: 'tipA', parents: ['base'] },
    { hash: 'tipB', parents: ['base'] },
    { hash: 'base', parents: [] },
  ]);

  assert.equal(rows[0].nodeLane, 0);
  assert.equal(rows[1].nodeLane, 1);
  // Both lanes collapse into base.
  assert.equal(rows[2].nodeLane, 0);
  assert.deepEqual(rows[2].inbound, [1]);
});

test('freed lanes are reused by later branch tips', () => {
  const rows = computeCommitGraph([
    { hash: 'a2', parents: ['a1'] },
    { hash: 'a1', parents: [] },        // lane 0 ends here
    { hash: 'b1', parents: [] },        // new tip should reuse lane 0
  ]);

  assert.equal(rows[2].nodeLane, 0);
  assert.equal(rows[2].laneCount, 1);
});

test('commits without parents metadata degrade gracefully', () => {
  const rows = computeCommitGraph([{ hash: 'x' }, { hash: 'y' }]);
  // Without parent info every commit is a standalone tip; the second one
  // reuses the freed lane.
  assert.deepEqual(rows.map((row) => row.nodeLane), [0, 0]);
  assert.deepEqual(rows.map((row) => row.hasParentContinuation), [false, false]);
});
