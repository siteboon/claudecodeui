import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRestoreCheck, resolveVerifiedRestore } from './useLastSessionRestore';

test('resolveRestoreCheck skips when the URL already points at a session', () => {
  assert.deepEqual(
    resolveRestoreCheck({ isPWA: true, urlSessionId: 'session-1', storedSessionId: 'session-2' }),
    { kind: 'none' },
  );
});

test('resolveRestoreCheck skips outside standalone PWA display mode', () => {
  assert.deepEqual(
    resolveRestoreCheck({ isPWA: false, storedSessionId: 'session-1' }),
    { kind: 'none' },
  );
});

test('resolveRestoreCheck skips when nothing was remembered', () => {
  assert.deepEqual(resolveRestoreCheck({ isPWA: true }), { kind: 'none' });
  assert.deepEqual(resolveRestoreCheck({ isPWA: true, storedSessionId: '' }), { kind: 'none' });
});

test('resolveRestoreCheck verifies a cold start at home with a remembered session', () => {
  assert.deepEqual(
    resolveRestoreCheck({ isPWA: true, storedSessionId: 'session-1' }),
    { kind: 'verify', sessionId: 'session-1' },
  );
});

test('resolveVerifiedRestore navigates when the session still exists', () => {
  assert.equal(resolveVerifiedRestore(true), 'navigate');
});

test('resolveVerifiedRestore forgets a deleted session', () => {
  assert.equal(resolveVerifiedRestore(false), 'forget');
});

test('resolveVerifiedRestore keeps the memory when the lookup fails', () => {
  assert.equal(resolveVerifiedRestore(null), 'keep');
});
