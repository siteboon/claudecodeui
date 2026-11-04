import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexTranscriptRelocationProvider } from '@/modules/providers/list/codex/codex-transcript-relocation.provider.js';

test('a relocated rollout records the new cwd and keeps its permissions', {
  skip: process.platform === 'win32' && 'Windows has no POSIX permission bits',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-transcript-relocation-'));
  try {
    const rolloutPath = path.join(root, 'rollout.jsonl');
    await writeFile(rolloutPath, `${JSON.stringify({ type: 'session_meta', payload: { cwd: '/home/u/alpha' } })}\n`);
    await chmod(rolloutPath, 0o660);

    // A 002 umask, common on dev and CI machines, would keep 0660 without the chmod after
    // the write; 077 makes writeFile's mode alone drop the group bits.
    const previousUmask = process.umask(0o077);
    try {
      const relocated = await new CodexTranscriptRelocationProvider().relocateTranscripts({
        sessions: [{ sessionId: 's1', jsonlPath: rolloutPath }],
        oldProjectPath: '/home/u/alpha',
        newProjectPath: '/home/u/beta',
      });
      assert.deepEqual(relocated, [{ sessionId: 's1', jsonlPath: rolloutPath }]);
    } finally {
      process.umask(previousUmask);
    }

    assert.match(await readFile(rolloutPath, 'utf8'), /"cwd":"\/home\/u\/beta"/);
    assert.equal((await stat(rolloutPath)).mode & 0o777, 0o660);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
