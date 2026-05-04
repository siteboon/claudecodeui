import assert from 'node:assert/strict';

vi.mock('@/modules/providers/services/sessions.service.js', () => ({
  sessionsService: { ensureSessionAndProject: vi.fn() },
}));
vi.mock('@/modules/providers/services/provider-auth.service.js', () => ({
  providerAuthService: { getProviderStatus: vi.fn().mockResolvedValue({ authenticated: true }) },
}));

/* eslint-disable boundaries/no-unknown -- root-level server file, not a module */
import {
  spawnOpenClaude,
  abortOpenClaudeSession,
  isOpenClaudeSessionActive,
  getActiveOpenClaudeSessions,
} from '@/openclaude-cli.js';
/* eslint-enable boundaries/no-unknown */

test('spawnOpenClaude is a function', () => {
  assert.equal(typeof spawnOpenClaude, 'function');
});

test('abortOpenClaudeSession is a function', () => {
  assert.equal(typeof abortOpenClaudeSession, 'function');
});

test('isOpenClaudeSessionActive is a function', () => {
  assert.equal(typeof isOpenClaudeSessionActive, 'function');
});

test('getActiveOpenClaudeSessions is a function', () => {
  assert.equal(typeof getActiveOpenClaudeSessions, 'function');
});

test('abortOpenClaudeSession returns false for unknown session', () => {
  assert.equal(abortOpenClaudeSession('nonexistent-session'), false);
});

test('isOpenClaudeSessionActive returns false for unknown session', () => {
  assert.equal(isOpenClaudeSessionActive('nonexistent-session'), false);
});

test('getActiveOpenClaudeSessions returns a Map', () => {
  const sessions = getActiveOpenClaudeSessions();
  assert.ok(sessions instanceof Map);
});
