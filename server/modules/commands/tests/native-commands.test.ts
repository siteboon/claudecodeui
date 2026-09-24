import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearNativeCommandsCache,
  getNativeCommands,
  recordNativeCommands,
} from '@/modules/commands/native-commands.js';

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

test('a recorded catalogue replaces the static fallback for that provider only', () => {
  clearNativeCommandsCache();
  try {
    recordNativeCommands('claude', [
      { name: '/compact', description: 'Recorded compact' },
      { name: '/machine-specific-skill', description: 'From a local plugin' },
    ]);

    const claude = getNativeCommands('claude');
    assert.deepEqual(claude.map((command) => command.name), ['/compact', '/machine-specific-skill']);

    // The recording must not leak into the other providers' tables.
    assert.ok(!getNativeCommands('codex').some((command) => command.name === '/machine-specific-skill'));
    assert.ok(getNativeCommands('codex').length > 0, 'codex keeps its fallback');
  } finally {
    clearNativeCommandsCache();
  }
});

test('a later catalogue replaces an earlier one instead of merging with it', () => {
  clearNativeCommandsCache();
  try {
    recordNativeCommands('claude', [{ name: '/first', description: 'init capture' }]);
    recordNativeCommands('claude', [{ name: '/second', description: 'commands_changed push' }]);

    assert.deepEqual(
      getNativeCommands('claude').map((command) => command.name),
      ['/second'],
    );
  } finally {
    clearNativeCommandsCache();
  }
});

test('recorded commands are normalized and junk entries are dropped', () => {
  clearNativeCommandsCache();
  try {
    recordNativeCommands('claude', [
      { name: 'naked', description: 'without the leading slash' },
      { name: '/hinted', description: 'with an argument hint', argumentHint: '<file>' },
      { name: '', description: 'nameless entries are dropped' },
      { description: 'not even a name' },
    ] as never);

    assert.deepEqual(getNativeCommands('claude'), [
      { name: '/naked', description: 'without the leading slash' },
      { name: '/hinted', description: 'with an argument hint', argumentHint: '<file>' },
    ]);
  } finally {
    clearNativeCommandsCache();
  }
});

test('an empty catalogue recording is ignored so the fallback survives', () => {
  clearNativeCommandsCache();
  try {
    recordNativeCommands('codex', []);
    assert.ok(getNativeCommands('codex').length > 0);
  } finally {
    clearNativeCommandsCache();
  }
});
