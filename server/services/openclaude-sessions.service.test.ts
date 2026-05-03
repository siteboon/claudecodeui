import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type OpenClaudeSession,
  parseOpenClaudeSessionDir,
  OPENCLAUDE_PROJECTS_DIR,
} from '@/services/openclaude-sessions.service.js';

test('OPENCLAUDE_PROJECTS_DIR points to ~/.openclaude/projects', () => {
  assert.ok(OPENCLAUDE_PROJECTS_DIR.includes('.openclaude'));
  assert.ok(OPENCLAUDE_PROJECTS_DIR.endsWith('projects'));
});

test('parseOpenClaudeSessionDir returns empty array when directory does not exist', async () => {
  const sessions = await parseOpenClaudeSessionDir('/nonexistent/path/that/should/not/exist');
  assert.deepEqual(sessions, []);
});

test('parseOpenClaudeSessionDir returns sessions from a valid directory', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-test-'));
  const projectDir = path.join(tmpDir, 'my-project');
  await fs.mkdir(projectDir, { recursive: true });

  const sessionFile = path.join(projectDir, 'session-abc123.jsonl');
  await fs.writeFile(
    sessionFile,
    JSON.stringify({ type: 'user', message: { content: 'Hello' }, timestamp: '2025-01-01T00:00:00Z' }) + '\n' +
    JSON.stringify({ type: 'assistant', message: { content: 'Hi there' }, timestamp: '2025-01-01T00:01:00Z' }) + '\n',
  );

  try {
    const sessions = await parseOpenClaudeSessionDir(tmpDir);
    assert.ok(sessions.length >= 1);

    const session = sessions.find((s: OpenClaudeSession) => s.id === 'session-abc123');
    assert.ok(session, 'should find session by id');
    assert.equal(session!.projectName, 'my-project');
    assert.equal(session!.messageCount, 2);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('parseOpenClaudeSessionDir skips non-jsonl files', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-test-'));
  const projectDir = path.join(tmpDir, 'test-project');
  await fs.mkdir(projectDir, { recursive: true });

  await fs.writeFile(path.join(projectDir, 'notes.txt'), 'not a session');
  await fs.writeFile(path.join(projectDir, 'config.json'), '{}');

  try {
    const sessions = await parseOpenClaudeSessionDir(tmpDir);
    assert.deepEqual(sessions, []);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
