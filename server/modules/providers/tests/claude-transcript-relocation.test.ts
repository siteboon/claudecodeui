import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeTranscriptRelocationProvider } from '@/modules/providers/list/claude/claude-transcript-relocation.provider.js';
import { AppError } from '@/shared/utils.js';

function encodeClaudeProjectDirName(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

async function withClaudeProjectsRoot(runTest: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'claude-transcript-relocation-'));
  try {
    await runTest(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeTranscript(directory: string, sessionId: string, cwd: string): Promise<string> {
  const transcriptPath = path.join(directory, `${sessionId}.jsonl`);
  await mkdir(directory, { recursive: true });
  await writeFile(transcriptPath, `${JSON.stringify({ sessionId, cwd })}\n`);
  return transcriptPath;
}

test('a copy already in the new folder is a 409 and the moves before it are undone', async () => {
  await withClaudeProjectsRoot(async (root) => {
    const oldProjectPath = '/home/u/alpha';
    const newProjectPath = '/home/u/beta';
    const oldDirectory = path.join(root, encodeClaudeProjectDirName(oldProjectPath));
    const newDirectory = path.join(root, encodeClaudeProjectDirName(newProjectPath));

    const movedFirst = await writeTranscript(oldDirectory, 'session-a', oldProjectPath);
    const subagentPath = path.join(oldDirectory, 'session-a', 'subagents', 'agent-1.jsonl');
    await mkdir(path.dirname(subagentPath), { recursive: true });
    await writeFile(subagentPath, '{}\n');
    const blocked = await writeTranscript(oldDirectory, 'session-b', oldProjectPath);
    // Left by resuming session-b from the renamed folder before relocating it.
    const existingCopy = await writeTranscript(newDirectory, 'session-b', oldProjectPath);

    await assert.rejects(
      () => new ClaudeTranscriptRelocationProvider().relocateTranscripts({
        sessions: [
          { sessionId: 'a', jsonlPath: movedFirst },
          { sessionId: 'b', jsonlPath: blocked },
        ],
        oldProjectPath,
        newProjectPath,
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, 'TRANSCRIPT_ALREADY_EXISTS');
        assert.match(String(error.details), /session-b\.jsonl/);
        return true;
      },
    );

    // session-a was fully moved before session-b failed; all of it is back.
    assert.equal(JSON.parse(await readFile(movedFirst, 'utf8')).cwd, oldProjectPath);
    assert.equal(await readFile(subagentPath, 'utf8'), '{}\n');
    await assert.rejects(() => readFile(path.join(newDirectory, 'session-a.jsonl'), 'utf8'));
    await assert.rejects(() => readFile(path.join(newDirectory, 'session-a', 'subagents', 'agent-1.jsonl'), 'utf8'));
    // Neither the blocked original nor the copy that blocked it is touched.
    assert.equal(JSON.parse(await readFile(blocked, 'utf8')).cwd, oldProjectPath);
    assert.equal(JSON.parse(await readFile(existingCopy, 'utf8')).cwd, oldProjectPath);
  });
});

test('on macOS a decomposed accent encodes the way the SDK does', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  try {
    await withClaudeProjectsRoot(async (root) => {
      // "café" as macOS file APIs often hand it back: "e" plus a combining accent.
      const oldProjectPath = '/Users/u/café';
      const newProjectPath = '/Users/u/café-2';
      // The SDK encodes the NFC form, where the accent is one character.
      const sdkOldDirectory = path.join(root, encodeClaudeProjectDirName(oldProjectPath.normalize('NFC')));
      const sdkNewDirectory = path.join(root, encodeClaudeProjectDirName(newProjectPath.normalize('NFC')));
      const transcriptPath = await writeTranscript(sdkOldDirectory, 'session-a', oldProjectPath);

      const moved = await new ClaudeTranscriptRelocationProvider().relocateTranscripts({
        sessions: [{ sessionId: 'a', jsonlPath: transcriptPath }],
        oldProjectPath,
        newProjectPath,
      });

      assert.deepEqual(moved, [{ sessionId: 'a', jsonlPath: path.join(sdkNewDirectory, 'session-a.jsonl') }]);
    });
  } finally {
    Object.defineProperty(process, 'platform', platform as PropertyDescriptor);
  }
});
