import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCodexExecutablePath } from '@/shared/codex-cli-path.js';

test('resolveCodexExecutablePath returns undefined when no override is configured', () => {
  assert.equal(resolveCodexExecutablePath(''), undefined);
  assert.equal(resolveCodexExecutablePath('   '), undefined);
});

test('resolveCodexExecutablePath trims an explicit path', () => {
  assert.equal(resolveCodexExecutablePath('  /opt/codex/bin/codex  '), '/opt/codex/bin/codex');
});

test('resolveCodexExecutablePath strips wrapping quotes from .env values', () => {
  assert.equal(resolveCodexExecutablePath('"/opt/codex custom/bin/codex"'), '/opt/codex custom/bin/codex');
  assert.equal(resolveCodexExecutablePath("'/opt/codex custom/bin/codex'"), '/opt/codex custom/bin/codex');
});
