import test from 'node:test';
import assert from 'node:assert/strict';

import { getSessionName } from './utils';
import type { SessionWithProvider } from '../types/types';

// Minimal stub for i18next's `t` — the fallback keys are fine as return values.
const t = ((key: string) => key) as unknown as Parameters<typeof getSessionName>[1];

const baseClaude: SessionWithProvider = {
  id: 'abc',
  __provider: 'claude',
};

test('getSessionName: customName wins over CLI summary (claude)', () => {
  const session: SessionWithProvider = {
    ...baseClaude,
    customName: 'User pinned name',
    summary: 'churning CLI summary',
    firstUserMessage: 'hello',
  };
  assert.equal(getSessionName(session, t), 'User pinned name');
});

test('getSessionName: customName wins across cursor/codex/gemini providers', () => {
  for (const provider of ['cursor', 'codex', 'gemini'] as const) {
    const session: SessionWithProvider = {
      id: `${provider}-id`,
      __provider: provider,
      customName: 'Pinned',
      summary: 'ignored-summary',
      name: 'ignored-name',
    };
    assert.equal(getSessionName(session, t), 'Pinned', `expected customName for ${provider}`);
  }
});

test('getSessionName: falls back to existing logic when customName is absent (claude)', () => {
  const withSummary: SessionWithProvider = {
    ...baseClaude,
    summary: 'Nice Claude summary',
    firstUserMessage: 'hi',
  };
  assert.equal(getSessionName(withSummary, t), 'Nice Claude summary');

  // "New Session" is a sentinel that means "no real summary yet" — use firstUserMessage.
  const stubSummary: SessionWithProvider = {
    ...baseClaude,
    summary: 'New Session',
    firstUserMessage: 'hi there',
  };
  assert.equal(getSessionName(stubSummary, t), 'hi there');

  const noContent: SessionWithProvider = { ...baseClaude };
  assert.equal(getSessionName(noContent, t), 'projects.newSession');
});

test('getSessionName: customName is sticky — a churning CLI summary does not override it', () => {
  const before: SessionWithProvider = {
    ...baseClaude,
    customName: 'Sticky',
    summary: 'v1',
  };
  const after: SessionWithProvider = {
    ...baseClaude,
    customName: 'Sticky',
    summary: 'v2 — CLI re-summarized after another send',
  };
  assert.equal(getSessionName(before, t), 'Sticky');
  assert.equal(getSessionName(after, t), 'Sticky');
});
