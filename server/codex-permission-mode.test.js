import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEX_PERMISSION_MODE_ENV,
  getConfiguredCodexPermissionMode,
  resolveCodexPermissionMode,
} from './codex-permission-mode.js';

function createLogger() {
  const warnings = [];
  return {
    warnings,
    warn(message) {
      warnings.push(message);
    },
  };
}

test('resolveCodexPermissionMode preserves an explicit request mode when env is unset', () => {
  const logger = createLogger();

  const resolved = resolveCodexPermissionMode('acceptEdits', true, {
    env: {},
    logger,
  });

  assert.equal(resolved, 'acceptEdits');
  assert.deepEqual(logger.warnings, []);
});

test('resolveCodexPermissionMode lets explicit request mode override env fallback', () => {
  const logger = createLogger();

  const resolved = resolveCodexPermissionMode('default', true, {
    env: { [CODEX_PERMISSION_MODE_ENV]: 'bypassPermissions' },
    logger,
  });

  assert.equal(resolved, 'default');
  assert.deepEqual(logger.warnings, []);
});

test('resolveCodexPermissionMode defaults omitted mode to default when env is unset', () => {
  const logger = createLogger();

  const resolved = resolveCodexPermissionMode(undefined, false, {
    env: {},
    logger,
  });

  assert.equal(resolved, 'default');
  assert.deepEqual(logger.warnings, []);
});

test('resolveCodexPermissionMode uses acceptEdits env fallback when request omits mode', () => {
  const logger = createLogger();

  const resolved = resolveCodexPermissionMode(undefined, false, {
    env: { [CODEX_PERMISSION_MODE_ENV]: 'acceptEdits' },
    logger,
  });

  assert.equal(resolved, 'acceptEdits');
  assert.deepEqual(logger.warnings, []);
});

test('resolveCodexPermissionMode uses bypassPermissions env fallback when request omits mode', () => {
  const logger = createLogger();

  const resolved = resolveCodexPermissionMode(undefined, false, {
    env: { [CODEX_PERMISSION_MODE_ENV]: 'bypassPermissions' },
    logger,
  });

  assert.equal(resolved, 'bypassPermissions');
  assert.deepEqual(logger.warnings, []);
});

test('getConfiguredCodexPermissionMode warns and falls back to default for invalid env values', () => {
  const logger = createLogger();

  const resolved = getConfiguredCodexPermissionMode({
    [CODEX_PERMISSION_MODE_ENV]: 'bad\nmode',
  }, logger);

  assert.equal(resolved, 'default');
  assert.deepEqual(logger.warnings, [
    `[Codex] Invalid ${CODEX_PERMISSION_MODE_ENV}="bad\\nmode"; falling back to default`,
  ]);
});

test('resolveCodexPermissionMode warns and falls back to default for invalid request values', () => {
  const logger = createLogger();

  const resolved = resolveCodexPermissionMode('bad\nmode', true, {
    env: { [CODEX_PERMISSION_MODE_ENV]: 'acceptEdits' },
    logger,
  });

  assert.equal(resolved, 'default');
  assert.deepEqual(logger.warnings, [
    '[Codex] Invalid request permission mode="bad\\nmode"; falling back to default',
  ]);
});
