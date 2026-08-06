import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildShellCommand,
  shouldSkipClaudePermissions,
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

const SKIP = '--dangerously-skip-permissions';

test('claude launches WITHOUT skip-permissions by default (no env, no flag)', () => {
  const command = buildShellCommand({ provider: 'claude' }, deps, { env: {}, platform: 'linux' });
  assert.equal(command, 'claude');
  assert.ok(!command.includes(SKIP));
});

test('claude resume launches without skip-permissions by default (posix)', () => {
  const command = buildShellCommand(
    { provider: 'claude', hasSession: true, sessionId: 'sess-1' },
    deps,
    { env: {}, platform: 'linux' },
  );
  assert.equal(command, 'claude --resume "sess-1" || claude');
  assert.ok(!command.includes(SKIP));
});

test('claude resume launches without skip-permissions by default (win32)', () => {
  const command = buildShellCommand(
    { provider: 'claude', hasSession: true, sessionId: 'sess-1' },
    deps,
    { env: {}, platform: 'win32' },
  );
  assert.equal(
    command,
    'claude --resume "sess-1"; if ($LASTEXITCODE -ne 0) { claude }',
  );
  assert.ok(!command.includes(SKIP));
});

test('SHELL_DANGEROUSLY_SKIP_PERMISSIONS=true enables the flag on the base command', () => {
  const command = buildShellCommand({ provider: 'claude' }, deps, {
    env: { SHELL_DANGEROUSLY_SKIP_PERMISSIONS: 'true' },
    platform: 'linux',
  });
  assert.equal(command, `claude ${SKIP}`);
});

test('env opt-in applies the flag to both sides of the posix resume fallback', () => {
  const command = buildShellCommand(
    { provider: 'claude', hasSession: true, sessionId: 'sess-1' },
    deps,
    { env: { SHELL_DANGEROUSLY_SKIP_PERMISSIONS: '1' }, platform: 'linux' },
  );
  assert.equal(command, `claude ${SKIP} --resume "sess-1" || claude ${SKIP}`);
});

test('env opt-in applies the flag to both sides of the win32 resume fallback', () => {
  const command = buildShellCommand(
    { provider: 'claude', hasSession: true, sessionId: 'sess-1' },
    deps,
    { env: { SHELL_DANGEROUSLY_SKIP_PERMISSIONS: 'on' }, platform: 'win32' },
  );
  assert.equal(
    command,
    `claude ${SKIP} --resume "sess-1"; if ($LASTEXITCODE -ne 0) { claude ${SKIP} }`,
  );
});

test('an explicit per-session request enables the flag even when env is unset', () => {
  const command = buildShellCommand(
    { provider: 'claude', dangerouslySkipPermissions: true },
    deps,
    { env: {}, platform: 'linux' },
  );
  assert.equal(command, `claude ${SKIP}`);
});

test('an explicit per-session opt-out overrides an enabled env default', () => {
  const command = buildShellCommand(
    { provider: 'claude', dangerouslySkipPermissions: false },
    deps,
    { env: { SHELL_DANGEROUSLY_SKIP_PERMISSIONS: 'true' }, platform: 'linux' },
  );
  assert.equal(command, 'claude');
});

test('the flag never leaks into other providers', () => {
  const env = { SHELL_DANGEROUSLY_SKIP_PERMISSIONS: 'true' };
  for (const provider of ['codex', 'cursor', 'opencode']) {
    const command = buildShellCommand({ provider }, deps, { env, platform: 'linux' });
    assert.ok(!command.includes(SKIP), `${provider} should never receive ${SKIP}`);
  }
});

test('plain shell mode is unaffected by the opt-in', () => {
  const command = buildShellCommand(
    { isPlainShell: true, initialCommand: 'ls -la' },
    deps,
    { env: { SHELL_DANGEROUSLY_SKIP_PERMISSIONS: 'true' }, platform: 'linux' },
  );
  assert.equal(command, 'ls -la');
});

test('shouldSkipClaudePermissions treats only truthy env spellings as on', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
    assert.equal(
      shouldSkipClaudePermissions({}, { SHELL_DANGEROUSLY_SKIP_PERMISSIONS: value }),
      true,
      `"${value}" should enable`,
    );
  }
  for (const value of ['0', 'false', 'off', 'no', '', 'enabled', 'maybe']) {
    assert.equal(
      shouldSkipClaudePermissions({}, { SHELL_DANGEROUSLY_SKIP_PERMISSIONS: value }),
      false,
      `"${value}" should not enable`,
    );
  }
});

test('shouldSkipClaudePermissions defaults to off when nothing is set', () => {
  assert.equal(shouldSkipClaudePermissions({}, {}), false);
});

test('shouldSkipClaudePermissions honours an explicit request over env', () => {
  assert.equal(
    shouldSkipClaudePermissions({ dangerouslySkipPermissions: true }, {}),
    true,
  );
  assert.equal(
    shouldSkipClaudePermissions(
      { dangerouslySkipPermissions: false },
      { SHELL_DANGEROUSLY_SKIP_PERMISSIONS: 'true' },
    ),
    false,
  );
});
