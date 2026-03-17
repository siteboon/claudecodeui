import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFallbackCommand, createShellSpawnPlan, quoteShellArgument } from './shell.js';

// This test verifies the backend can ask for a shell launch without branching on the OS at every call site.
test('createShellSpawnPlan returns the expected executable and argv per platform', () => {
  assert.deepEqual(createShellSpawnPlan('echo hello', 'windows'), {
    platform: 'windows',
    executable: 'powershell.exe',
    args: ['-Command', 'echo hello'],
    commandFlag: '-Command',
    preferredLineEnding: 'crlf',
    pathSeparator: '\\',
  });

  assert.deepEqual(createShellSpawnPlan('echo hello', 'linux'), {
    platform: 'linux',
    executable: 'bash',
    args: ['-c', 'echo hello'],
    commandFlag: '-c',
    preferredLineEnding: 'lf',
    pathSeparator: '/',
  });
});

// This test verifies shell quoting rules stay isolated inside the adapter layer.
test('quoteShellArgument escapes embedded single quotes correctly', () => {
  assert.equal(quoteShellArgument("it's", 'windows'), "'it''s'");
  assert.equal(quoteShellArgument("it's", 'linux'), `'it'"'"'s'`);
});

// This test verifies resume-or-fallback command composition stays platform-specific in one helper.
test('buildFallbackCommand emits PowerShell or POSIX fallback syntax', () => {
  assert.equal(
    buildFallbackCommand("codex resume '123'", 'codex', 'windows'),
    "codex resume '123'; if ($LASTEXITCODE -ne 0) { codex }",
  );
  assert.equal(
    buildFallbackCommand("codex resume '123'", 'codex', 'linux'),
    "codex resume '123' || codex",
  );
});
