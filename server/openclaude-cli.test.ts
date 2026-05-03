import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  spawnOpenClaude,
  abortOpenClaudeSession,
  isOpenClaudeSessionActive,
  getActiveOpenClaudeSessions,
  buildOpenClaudeArgs,
} from './openclaude-cli.js';

// ─── Export shape tests ───

test('openclaude-cli exports spawnOpenClaude as a function', () => {
  assert.equal(typeof spawnOpenClaude, 'function');
});

test('openclaude-cli exports abortOpenClaudeSession as a function', () => {
  assert.equal(typeof abortOpenClaudeSession, 'function');
});

test('openclaude-cli exports isOpenClaudeSessionActive as a function', () => {
  assert.equal(typeof isOpenClaudeSessionActive, 'function');
});

test('openclaude-cli exports getActiveOpenClaudeSessions as a function', () => {
  assert.equal(typeof getActiveOpenClaudeSessions, 'function');
});

// ─── Argument building tests ───

test('buildOpenClaudeArgs includes --print with the command', () => {
  const args = buildOpenClaudeArgs('hello world', {});
  assert.ok(args.includes('--print'));
  const printIndex = args.indexOf('--print');
  assert.equal(args[printIndex + 1], 'hello world');
});

test('buildOpenClaudeArgs includes --resume when sessionId with cliSessionId is provided', () => {
  const args = buildOpenClaudeArgs('continue', { resumeSessionId: 'sess_abc123' });
  assert.ok(args.includes('--resume'));
  const idx = args.indexOf('--resume');
  assert.equal(args[idx + 1], 'sess_abc123');
});

test('buildOpenClaudeArgs includes --model when specified', () => {
  const args = buildOpenClaudeArgs('test', { model: 'claude-sonnet-4-20250514' });
  assert.ok(args.includes('--model'));
  const idx = args.indexOf('--model');
  assert.equal(args[idx + 1], 'claude-sonnet-4-20250514');
});

test('buildOpenClaudeArgs includes --output-format stream-json', () => {
  const args = buildOpenClaudeArgs('test', {});
  assert.ok(args.includes('--output-format'));
  const idx = args.indexOf('--output-format');
  assert.equal(args[idx + 1], 'stream-json');
});

test('buildOpenClaudeArgs includes --permission-mode bypass for API calls', () => {
  const args = buildOpenClaudeArgs('test', { skipPermissions: true });
  assert.ok(
    args.includes('--dangerously-skip-permissions') || args.includes('--permission-mode'),
    'Should include permission bypass flag'
  );
});

test('buildOpenClaudeArgs does NOT include --print when command is empty', () => {
  const args = buildOpenClaudeArgs('', {});
  assert.ok(!args.includes('--print'));
});

// ─── Session tracking tests ───

test('isOpenClaudeSessionActive returns false for unknown session', () => {
  assert.equal(isOpenClaudeSessionActive('nonexistent_session'), false);
});

test('getActiveOpenClaudeSessions returns empty array initially', () => {
  const sessions = getActiveOpenClaudeSessions();
  assert.ok(Array.isArray(sessions));
  assert.equal(sessions.length, 0);
});

test('abortOpenClaudeSession returns false for unknown session', () => {
  assert.equal(abortOpenClaudeSession('nonexistent'), false);
});
