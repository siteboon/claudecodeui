import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

async function writeCodexJsonl(filePath: string, rows: unknown[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
}

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

test('Codex synchronizer skips subagent transcripts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-sync-'));
  const filePath = path.join(dir, 'child.jsonl');
  await writeCodexJsonl(filePath, [{
    type: 'session_meta',
    payload: {
      id: 'child-1',
      cwd: '/workspace/demo',
      thread_source: 'subagent',
      parent_thread_id: 'parent-1',
    },
  }]);

  const synchronizer = new CodexSessionSynchronizer();

  assert.equal(await synchronizer.synchronizeFile(filePath), null);
});
