import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ensureAskpassFiles,
  registerSudoRun,
  unregisterSudoRun,
  validateAskpassToken,
  requestSudoPassword,
  resolveSudoPassword,
} from './sudo-askpass.service.js';

type FakeWs = { sent: string[]; send: (data: string) => void };

function makeWs(): FakeWs {
  const sent: string[] = [];
  return { sent, send: (data: string) => sent.push(data) };
}

// ─── Files / env builder ─────────────────────────────────────────────────────

test('ensureAskpassFiles writes an executable sudo shim that forces -A', () => {
  const files = ensureAskpassFiles();
  assert.ok(fs.existsSync(files.sudoShimPath), 'shim exists');
  assert.ok(fs.existsSync(files.askpassPath), 'askpass helper exists');
  const shim = fs.readFileSync(files.sudoShimPath, 'utf8');
  assert.match(shim, /-A/, 'shim passes -A to real sudo');
  // both files must be executable
  assert.ok((fs.statSync(files.sudoShimPath).mode & 0o100) !== 0, 'shim is executable');
  assert.ok((fs.statSync(files.askpassPath).mode & 0o100) !== 0, 'helper is executable');
});

test('registerSudoRun returns a token and an env pointing at the helper', () => {
  const ws = makeWs();
  const { token, env } = registerSudoRun(ws, 'sess-1', 'claude');
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 32, 'token is high-entropy');
  assert.ok(fs.existsSync(env.SUDO_ASKPASS), 'SUDO_ASKPASS points at a real file');
  assert.ok(env.PATH.startsWith(env.SUDO_ASKPASS.replace(/\/[^/]+$/, '')), 'shim dir is first on PATH');
  assert.equal(env.AIGM_ASKPASS_TOKEN, token);
  assert.ok(Number(env.AIGM_ASKPASS_PORT) > 0);
  unregisterSudoRun(token);
});

// ─── Token validation ────────────────────────────────────────────────────────

test('validateAskpassToken maps a live token to its run and rejects unknown ones', () => {
  const ws = makeWs();
  const { token } = registerSudoRun(ws, 'sess-2', 'gemini');
  const entry = validateAskpassToken(token);
  assert.ok(entry, 'known token resolves');
  assert.equal(entry?.sessionId, 'sess-2');
  assert.equal(validateAskpassToken('does-not-exist'), null);
  assert.equal(validateAskpassToken(''), null);
  unregisterSudoRun(token);
  assert.equal(validateAskpassToken(token), null, 'token invalid after unregister');
});

// ─── Request / resolve round-trip ────────────────────────────────────────────

test('requestSudoPassword resolves with the password supplied to resolveSudoPassword', async () => {
  const ws = makeWs();
  const { token } = registerSudoRun(ws, 'sess-3', 'claude');

  const pending = requestSudoPassword({ token, prompt: '[sudo] password for piotr: ' });

  // the prompt must have been pushed to the client; pull the requestId back out
  assert.equal(ws.sent.length, 1, 'one prompt sent to the client');
  const msg = JSON.parse(ws.sent[0]);
  assert.equal(msg.kind, 'sudo_password_request');
  assert.equal(typeof msg.requestId, 'string');

  resolveSudoPassword(msg.requestId, { password: 's3cret' });
  assert.equal(await pending, 's3cret');
  unregisterSudoRun(token);
});

test('requestSudoPassword rejects when the user cancels', async () => {
  const ws = makeWs();
  const { token } = registerSudoRun(ws, 'sess-4', 'claude');
  const pending = requestSudoPassword({ token, prompt: 'x' });
  const requestId = JSON.parse(ws.sent[0]).requestId;
  resolveSudoPassword(requestId, { cancel: true });
  await assert.rejects(pending, /cancel/i);
  unregisterSudoRun(token);
});

test('requestSudoPassword rejects an invalid token without sending anything', async () => {
  await assert.rejects(requestSudoPassword({ token: 'bogus', prompt: 'x' }), /token/i);
});

test('resolveSudoPassword for an unknown requestId is a no-op (no throw)', () => {
  assert.doesNotThrow(() => resolveSudoPassword('nope', { password: 'x' }));
});
