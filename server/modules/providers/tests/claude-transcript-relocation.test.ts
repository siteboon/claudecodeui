import assert from 'node:assert/strict';
import fsPromises, { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

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

/**
 * Fails the first `rename` that `matches` picks, the way a permission error
 * would. The provider imports `rename` by name, so the builtin's named exports
 * are re-synced after mocking it.
 */
async function withFailingRename(
  matches: (from: string, to: string) => boolean,
  runTest: () => Promise<void>,
): Promise<void> {
  const realRename = fsPromises.rename;
  let failed = false;
  mock.method(fsPromises, 'rename', async (from: string, to: string) => {
    if (!failed && matches(String(from), String(to))) {
      failed = true;
      throw Object.assign(new Error(`EACCES: permission denied, rename '${from}'`), { code: 'EACCES' });
    }
    return realRename(from, to);
  });
  syncBuiltinESMExports();
  try {
    await runTest();
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
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

test('an original that cannot leave the old folder undoes the whole move', async () => {
  await withClaudeProjectsRoot(async (root) => {
    const oldProjectPath = '/home/u/alpha';
    const newProjectPath = '/home/u/beta';
    const oldDirectory = path.join(root, encodeClaudeProjectDirName(oldProjectPath));
    const newDirectory = path.join(root, encodeClaudeProjectDirName(newProjectPath));
    const first = await writeTranscript(oldDirectory, 'session-a', oldProjectPath);
    const stuck = await writeTranscript(oldDirectory, 'session-b', oldProjectPath);

    // Left behind, the original still names the old folder, and a full scan
    // would file the session back under the old project.
    await withFailingRename((from) => from === stuck, async () => {
      await assert.rejects(() => new ClaudeTranscriptRelocationProvider().relocateTranscripts({
        sessions: [
          { sessionId: 'a', jsonlPath: first },
          { sessionId: 'b', jsonlPath: stuck },
        ],
        oldProjectPath,
        newProjectPath,
      }), /EACCES/);
    });

    assert.deepEqual((await readdir(oldDirectory)).sort(), ['session-a.jsonl', 'session-b.jsonl']);
    assert.equal(JSON.parse(await readFile(first, 'utf8')).cwd, oldProjectPath);
    assert.equal(JSON.parse(await readFile(stuck, 'utf8')).cwd, oldProjectPath);
    assert.deepEqual(await readdir(newDirectory), []);
  });
});

test('an in-place rewrite that cannot be swapped in undoes the others', async () => {
  await withClaudeProjectsRoot(async (root) => {
    // Both encode to the same folder, so the transcripts stay and only their cwd changes.
    const oldProjectPath = '/home/u/my project';
    const newProjectPath = '/home/u/my_project';
    const directory = path.join(root, encodeClaudeProjectDirName(oldProjectPath));
    const first = await writeTranscript(directory, 'session-a', oldProjectPath);
    const stuck = await writeTranscript(directory, 'session-b', oldProjectPath);

    // Reported as moved while still naming the old folder, the session would be
    // dragged back to it by the next synchronization.
    await withFailingRename((from, to) => to === stuck && from.endsWith('.tmp'), async () => {
      await assert.rejects(() => new ClaudeTranscriptRelocationProvider().relocateTranscripts({
        sessions: [
          { sessionId: 'a', jsonlPath: first },
          { sessionId: 'b', jsonlPath: stuck },
        ],
        oldProjectPath,
        newProjectPath,
      }), /EACCES/);
    });

    assert.deepEqual((await readdir(directory)).sort(), ['session-a.jsonl', 'session-b.jsonl']);
    assert.equal(JSON.parse(await readFile(first, 'utf8')).cwd, oldProjectPath);
    assert.equal(JSON.parse(await readFile(stuck, 'utf8')).cwd, oldProjectPath);
  });
});
