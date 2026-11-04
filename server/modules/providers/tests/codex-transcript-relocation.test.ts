import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexTranscriptRelocationProvider } from '@/modules/providers/list/codex/codex-transcript-relocation.provider.js';

test('a relocated rollout records the new cwd and keeps its private permissions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-relocation-'));
  try {
    const rolloutPath = path.join(root, 'rollout.jsonl');
    await writeFile(rolloutPath, `${JSON.stringify({ type: 'session_meta', payload: { cwd: '/home/u/alpha' } })}\n`);
    await chmod(rolloutPath, 0o600);

    const relocated = await new CodexTranscriptRelocationProvider().relocateTranscripts({
      sessions: [{ sessionId: 's1', jsonlPath: rolloutPath }],
      oldProjectPath: '/home/u/alpha',
      newProjectPath: '/home/u/beta',
    });

    assert.deepEqual(relocated, [{ sessionId: 's1', jsonlPath: rolloutPath }]);
    assert.match(await readFile(rolloutPath, 'utf8'), /"cwd":"\/home\/u\/beta"/);
    assert.equal((await stat(rolloutPath)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
