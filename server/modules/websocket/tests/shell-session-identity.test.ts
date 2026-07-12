import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildShellCommand,
  resolvePtySessionKey,
  resolveSessionAlias,
} from '@/modules/websocket/services/shell-websocket.service.js';

type Deps = Parameters<typeof buildShellCommand>[1];

// Only resolveProviderSessionId is exercised by buildShellCommand; the rest are
// output-scanning helpers that this path never calls.
const deps: Deps = {
  resolveProviderSessionId: (sessionId: string) => sessionId,
  stripAnsiSequences: (content: string) => content,
  normalizeDetectedUrl: () => null,
  extractUrlsFromText: () => [],
  shouldAutoOpenUrlFromOutput: () => false,
};

const UUID = '4c1f0f6e-9a68-4b25-a2f5-4a41f6cf80aa';

// --- resolvePtySessionKey -------------------------------------------------

test('new-session shells with distinct client ids get distinct PTY keys', () => {
  const base = { projectPath: '/p', sessionId: null, isPlainShell: false, initialCommand: '' };
  const keyA = resolvePtySessionKey({ ...base, shellClientId: 'tab-a' });
  const keyB = resolvePtySessionKey({ ...base, shellClientId: 'tab-b' });
  assert.notEqual(keyA, keyB);
});

test('the same client id resolves to the same key across reconnects', () => {
  const base = { projectPath: '/p', sessionId: null, isPlainShell: false, initialCommand: '' };
  assert.equal(
    resolvePtySessionKey({ ...base, shellClientId: 'tab-a' }),
    resolvePtySessionKey({ ...base, shellClientId: 'tab-a' }),
  );
});

test('legacy clients without a client id keep the shared default key', () => {
  const key = resolvePtySessionKey({
    projectPath: '/p',
    sessionId: null,
    shellClientId: null,
    isPlainShell: false,
    initialCommand: '',
  });
  assert.equal(key, '/p_default');
});

test('session-keyed shells ignore the client id so cross-device handoff still works', () => {
  const base = { projectPath: '/p', sessionId: 'sess-1', isPlainShell: false, initialCommand: '' };
  const fromTabA = resolvePtySessionKey({ ...base, shellClientId: 'tab-a' });
  const fromTabB = resolvePtySessionKey({ ...base, shellClientId: 'tab-b' });
  assert.equal(fromTabA, fromTabB);
  assert.equal(fromTabA, '/p_sess-1');
});

test('a malformed client id degrades to the legacy key instead of erroring', () => {
  const key = resolvePtySessionKey({
    projectPath: '/p',
    sessionId: null,
    shellClientId: 'evil/../id with spaces',
    isPlainShell: false,
    initialCommand: '',
  });
  assert.equal(key, '/p_default');
});

test('plain-shell command suffix is preserved with and without a client id', () => {
  const base = { projectPath: '/p', sessionId: null, isPlainShell: true, initialCommand: 'ls -la' };
  const legacy = resolvePtySessionKey({ ...base, shellClientId: null });
  const withId = resolvePtySessionKey({ ...base, shellClientId: 'tab-a' });
  const suffix = `_cmd_${Buffer.from('ls -la').toString('base64').slice(0, 16)}`;
  assert.equal(legacy, `/p_default${suffix}`);
  assert.equal(withId, `/p_new_tab-a${suffix}`);
});

// --- resolveSessionAlias ----------------------------------------------------

test('an alias routes a by-id open back to the original PTY key', () => {
  const aliases = new Map([[UUID, '/p_new_tab-a']]);
  const live = new Set(['/p_new_tab-a']);
  assert.equal(resolveSessionAlias(aliases, live, UUID), '/p_new_tab-a');
});

test('a stale alias (PTY gone) is dropped and returns null', () => {
  const aliases = new Map([[UUID, '/p_new_tab-a']]);
  const live = new Set<string>();
  assert.equal(resolveSessionAlias(aliases, live, UUID), null);
  assert.equal(aliases.has(UUID), false);
});

test('an unknown session id has no alias', () => {
  assert.equal(resolveSessionAlias(new Map(), new Set(), UUID), null);
});

// --- buildShellCommand: --session-id pre-assignment -------------------------

test('a brand-new claude session is launched with the pre-assigned session id', () => {
  const command = buildShellCommand({ provider: 'claude' }, deps, {
    newClaudeSessionId: UUID,
  });
  // The `|| claude` fallback mirrors the resume fallback: CLIs that predate
  // --session-id reject the flag and fall back to a plain launch.
  assert.equal(command, `claude --session-id "${UUID}" || claude`);
});

test('without a pre-assigned id the command is unchanged from today', () => {
  assert.equal(buildShellCommand({ provider: 'claude' }, deps), 'claude');
  assert.equal(buildShellCommand({ provider: 'claude' }, deps, {}), 'claude');
});

test('resume never carries --session-id (the session already has one)', () => {
  const command = buildShellCommand(
    { provider: 'claude', hasSession: true, sessionId: 'sess-1' },
    deps,
    { newClaudeSessionId: UUID },
  );
  assert.equal(command, 'claude --resume "sess-1" || claude');
});

test('an explicit initial command wins over the pre-assigned id', () => {
  const command = buildShellCommand(
    { provider: 'claude', hasSession: true, initialCommand: 'claude mcp list' },
    deps,
    { newClaudeSessionId: UUID },
  );
  assert.equal(command, 'claude mcp list');
});

test('other providers and plain shells never receive --session-id', () => {
  for (const provider of ['cursor', 'codex', 'opencode']) {
    const command = buildShellCommand({ provider }, deps, { newClaudeSessionId: UUID });
    assert.ok(!command.includes('--session-id'), `${provider} must not get --session-id`);
  }

  const plain = buildShellCommand(
    { isPlainShell: true, initialCommand: 'htop' },
    deps,
    { newClaudeSessionId: UUID },
  );
  assert.equal(plain, 'htop');
});
