import assert from 'node:assert/strict';
import test from 'node:test';

import { detectSudoPrompt } from './sudo';

// ─── Main behavior — detection ───────────────────────────────────────────────

test('detects the default English sudo prompt', () => {
  assert.equal(
    detectSudoPrompt('[sudo] password for piotrszmidt: '),
    '[sudo] password for piotrszmidt:',
  );
});

test('detects the Polish-locale sudo prompt (different wording, same marker)', () => {
  assert.equal(
    detectSudoPrompt('[sudo] hasło użytkownika piotr: '),
    '[sudo] hasło użytkownika piotr:',
  );
});

test('detects the prompt when preceded by earlier command output', () => {
  const buffer = ['$ sudo systemctl restart nginx', '[sudo] password for root: '].join('\n');
  assert.equal(detectSudoPrompt(buffer), '[sudo] password for root:');
});

test('re-detects the prompt after a wrong-password retry', () => {
  const buffer = ['[sudo] password for piotr: ', 'Sorry, try again.', '[sudo] password for piotr: '].join(
    '\n',
  );
  assert.equal(detectSudoPrompt(buffer), '[sudo] password for piotr:');
});

// ─── No false positives ──────────────────────────────────────────────────────

test('returns null for ordinary output mentioning sudo', () => {
  assert.equal(detectSudoPrompt('Run sudo apt update to install the package.'), null);
});

test('returns null when the [sudo] line is not the final prompt (already answered)', () => {
  const buffer = ['[sudo] password for piotr: ', 'nginx restarted', '$ '].join('\n');
  assert.equal(detectSudoPrompt(buffer), null);
});

test('returns null for empty input', () => {
  assert.equal(detectSudoPrompt(''), null);
});
