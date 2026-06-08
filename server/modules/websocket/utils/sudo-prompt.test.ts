import assert from 'node:assert/strict';
import test from 'node:test';

import { isSudoPasswordPrompt } from '@/modules/websocket/utils/sudo-prompt.js';

// ─── Main behaviour ──────────────────────────────────────────────────────────

test('detects the default English sudo prompt', () => {
  assert.equal(isSudoPasswordPrompt('[sudo] password for piotr: '), true);
});

test('detects the Polish-locale sudo prompt', () => {
  assert.equal(isSudoPasswordPrompt('[sudo] hasło użytkownika piotr: '), true);
});

test('detects the generic [sudo] password prompt without a username', () => {
  assert.equal(isSudoPasswordPrompt('[sudo] password: '), true);
});

test('detects the prompt when wrapped in ANSI colour escapes', () => {
  assert.equal(isSudoPasswordPrompt('\x1b[0m[sudo] password for piotr: \x1b[0m'), true);
});

test('detects the prompt when it is the last line after earlier output', () => {
  assert.equal(
    isSudoPasswordPrompt('Reading package lists...\r\n[sudo] password for piotr: '),
    true
  );
});

// ─── False positives must be avoided ─────────────────────────────────────────

test('ignores a non-sudo line that merely contains the word password', () => {
  assert.equal(isSudoPasswordPrompt('Enter your database password: '), false);
});

test('ignores a sudo prompt that is not the trailing line', () => {
  assert.equal(
    isSudoPasswordPrompt('[sudo] password for piotr: \r\nLogin successful\r\n$ '),
    false
  );
});

// ─── Backward compatibility — plain output stays untouched ────────────────────

test('plain terminal output is not treated as a sudo prompt', () => {
  assert.equal(isSudoPasswordPrompt('total 8\r\ndrwxr-xr-x  2 piotr piotr 4096 file.txt\r\n'), false);
});

test('empty output is not a sudo prompt', () => {
  assert.equal(isSudoPasswordPrompt(''), false);
});
