import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('@/modules/database/index.js', () => ({
  sessionsDb: {
    createSession: vi.fn(
      (sessionId: string) => sessionId
    ),
  },
}));

import { sessionsDb } from '@/modules/database/index.js';

import { OpenClaudeSessionSynchronizer } from '@/modules/providers/list/openclaude/openclaude-session-synchronizer.provider.js';

const TMP_OCC_HOME = path.join(os.tmpdir(), `occ-sync-test-${Date.now()}`);
const SESSIONS_DIR = path.join(TMP_OCC_HOME, 'sessions');

async function writeSessionFile(sessionId: string, projectPath: string): Promise<string> {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  const line = JSON.stringify({ sessionId, cwd: projectPath, type: 'init' });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, line + '\n', 'utf8');
  return filePath;
}

beforeEach(() => {
  vi.mocked(sessionsDb.createSession).mockClear();
});

afterAll(async () => {
  await fs.rm(TMP_OCC_HOME, { recursive: true, force: true });
});

test('synchronize returns count of discovered OCC sessions', async () => {
  await writeSessionFile('occ-sess-001', '/tmp/project-alpha');
  await writeSessionFile('occ-sess-002', '/tmp/project-beta');

  const sync = new OpenClaudeSessionSynchronizer(TMP_OCC_HOME);
  const count = await sync.synchronize();
  assert.ok(count >= 2, `Expected at least 2 sessions, got ${count}`);
  assert.ok(
    vi.mocked(sessionsDb.createSession).mock.calls.length >= 2,
    'createSession should have been called for each discovered session'
  );
});

test('synchronize respects since parameter for incremental scan', async () => {
  const futureDate = new Date(Date.now() + 60_000);
  const sync = new OpenClaudeSessionSynchronizer(TMP_OCC_HOME);
  const count = await sync.synchronize(futureDate);
  assert.equal(count, 0, 'No files should be newer than a future date');
});

test('synchronizeFile returns sessionId for valid OCC session file', async () => {
  const filePath = await writeSessionFile('occ-sess-003', '/tmp/project-gamma');

  const sync = new OpenClaudeSessionSynchronizer(TMP_OCC_HOME);
  const sessionId = await sync.synchronizeFile(filePath);
  assert.equal(sessionId, 'occ-sess-003');
});

test('synchronizeFile returns null for non-jsonl file', async () => {
  const sync = new OpenClaudeSessionSynchronizer(TMP_OCC_HOME);
  const sessionId = await sync.synchronizeFile('/tmp/fake.txt');
  assert.equal(sessionId, null);
});

test('synchronize handles missing sessions directory gracefully', async () => {
  const sync = new OpenClaudeSessionSynchronizer('/nonexistent/occ/path');
  const count = await sync.synchronize();
  assert.equal(count, 0);
});
