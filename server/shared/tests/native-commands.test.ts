import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginNativeCommandsCapture,
  clearNativeCommandsCache,
  getNativeCommands,
} from '@/shared/native-commands.js';

test('getNativeCommands returns the provider-specific fallback table', () => {
  const codex = getNativeCommands('codex').map((command) => command.name);

  assert.ok(codex.includes('/approve'), 'codex table should carry its own /approve');
  assert.ok(codex.includes('/diff'));
  assert.ok(!codex.includes('/context'), '/context is a Claude command, not a Codex one');
});

test('getNativeCommands keeps Claude commands out of the other providers', () => {
  const claude = getNativeCommands('claude').map((command) => command.name);
  const cursor = getNativeCommands('cursor').map((command) => command.name);
  const opencode = getNativeCommands('opencode').map((command) => command.name);

  assert.ok(claude.includes('/context'));
  assert.ok(!cursor.includes('/context'));
  assert.ok(!opencode.includes('/context'));
  assert.ok(opencode.includes('/undo'), 'opencode table should carry its own /undo');
});

test('getNativeCommands returns an empty list for an unknown provider', () => {
  assert.deepEqual(getNativeCommands('unknown-cli'), []);
});

test('a workspace capture replaces the fallback only for that workspace', () => {
  clearNativeCommandsCache();
  try {
    const recordA = beginNativeCommandsCapture('claude', 'C:\\repos\\a');
    recordA([
      { name: '/compact', description: 'Recorded compact' },
      { name: '/machine-specific-skill', description: 'From a local plugin' },
    ]);

    assert.deepEqual(
      getNativeCommands('claude', 'C:\\repos\\a').map((command) => command.name),
      ['/compact', '/machine-specific-skill'],
    );
    assert.ok(!getNativeCommands('codex', 'C:\\repos\\a').some((command) => command.name === '/machine-specific-skill'));
    assert.ok(getNativeCommands('codex', 'C:\\repos\\a').length > 0, 'codex keeps its fallback');
    assert.ok(getNativeCommands('claude', 'C:\\repos\\b').some((command) => command.name === '/compact'), 'workspace B has no capture, so it gets the fallback');
  } finally {
    clearNativeCommandsCache();
  }
});

test('the newest capture for a workspace wins, wherever it settles', () => {
  clearNativeCommandsCache();
  try {
    // Session one starts, then session two starts; session one's
    // initializationResult settles last. The stale write must be dropped.
    const recordSessionOne = beginNativeCommandsCapture('claude', 'C:\\repos\\a');
    const recordSessionTwo = beginNativeCommandsCapture('claude', 'C:\\repos\\a');

    recordSessionTwo([{ name: '/fresh', description: 'session two' }]);
    recordSessionOne([{ name: '/stale', description: 'session one' }]);

    assert.deepEqual(
      getNativeCommands('claude', 'C:\\repos\\a').map((command) => command.name),
      ['/fresh'],
    );
  } finally {
    clearNativeCommandsCache();
  }
});

test('an empty catalogue replaces a previous one once the workspace has a capture', () => {
  clearNativeCommandsCache();
  try {
    const record = beginNativeCommandsCapture('claude', 'C:\\repos\\a');
    record([{ name: '/compact', description: 'first' }]);
    record([]);

    assert.deepEqual(getNativeCommands('claude', 'C:\\repos\\a'), [], 'the CLI said there are none');
  } finally {
    clearNativeCommandsCache();
  }
});

test('an empty capture for a workspace does not disturb another workspace', () => {
  clearNativeCommandsCache();
  try {
    const recordA = beginNativeCommandsCapture('claude', 'C:\\repos\\a');
    recordA([{ name: '/project-skill', description: 'Workspace A only' }]);
    beginNativeCommandsCapture('claude', 'C:\\repos\\b')([]);

    assert.ok(getNativeCommands('claude', 'C:\\repos\\a').some((command) => command.name === '/project-skill'));
    assert.deepEqual(getNativeCommands('claude', 'C:\\repos\\b'), [], 'workspace B was told there are none — trust it, no fallback');
  } finally {
    clearNativeCommandsCache();
  }
});

test('recorded commands are normalized and junk entries are dropped', () => {
  clearNativeCommandsCache();
  try {
    const record = beginNativeCommandsCapture('claude', 'C:\\repos\\a');
    record([
      { name: 'naked', description: 'without the leading slash' },
      { name: '/hinted', description: 'with an argument hint', argumentHint: '<file>' },
      { name: '', description: 'nameless entries are dropped' },
      { description: 'not even a name' },
    ] as never);

    assert.deepEqual(getNativeCommands('claude', 'C:\\repos\\a'), [
      { name: '/naked', description: 'without the leading slash' },
      { name: '/hinted', description: 'with an argument hint', argumentHint: '<file>' },
    ]);
  } finally {
    clearNativeCommandsCache();
  }
});

test('recording a non-array is a no-op', () => {
  clearNativeCommandsCache();
  try {
    beginNativeCommandsCapture('claude', 'C:\\repos\\a')(undefined as never);
    assert.ok(getNativeCommands('claude', 'C:\\repos\\a').some((command) => command.name === '/compact'));
  } finally {
    clearNativeCommandsCache();
  }
});
