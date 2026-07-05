import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

test('Codex sessions provider marks turn_complete as a successful completion', () => {
  const provider = new CodexSessionsProvider();

  const normalized = provider.normalizeMessage({
    type: 'turn_complete',
    uuid: 'codex-turn-complete-1',
    timestamp: '2026-07-03T14:00:00.000Z',
  }, 'codex-session-1');

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.kind, 'complete');
  assert.equal(normalized[0]?.provider, 'codex');
  assert.equal(normalized[0]?.sessionId, 'codex-session-1');
  assert.equal(normalized[0]?.exitCode, 0);
  assert.equal(normalized[0]?.success, true);
  assert.equal(normalized[0]?.aborted, false);
});
