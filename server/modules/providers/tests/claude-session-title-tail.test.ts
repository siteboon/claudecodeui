import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { readFileTail } from '@/shared/utils.js';

/**
 * `extractSessionAiTitleFromEnd` used to `readFile()` the entire transcript on
 * every add/change event, for any session without a settled title. Title markers
 * are appended as the session runs, so the answer is always within the last few
 * hundred bytes — on a 6.1 MB transcript measured in the field the final marker
 * began 342 bytes from EOF, so the whole cost was the read and decode, not the
 * backward parse loop.
 *
 * These tests assert the read is now bounded, and that bounding it did not change
 * which title comes back.
 */

const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const TAIL_WINDOW = 64 * 1024;

let workDir: string;

/** Builds a JSONL transcript of at least `minBytes`, with `trailing` appended. */
const writeTranscript = async (
  name: string,
  minBytes: number,
  trailing: string[],
): Promise<string> => {
  const filler = `${JSON.stringify({
    type: 'assistant',
    sessionId: SESSION_ID,
    text: 'x'.repeat(512),
  })}\n`;
  const rows = Math.ceil(minBytes / filler.length);
  const body = filler.repeat(rows) + trailing.map((line) => `${line}\n`).join('');
  const filePath = path.join(workDir, name);
  await writeFile(filePath, body, 'utf8');
  return filePath;
};

/** Bytes this process has received from read syscalls (Linux `rchar`). */
const readProcessReadChars = async (): Promise<number> => {
  const io = await readFile('/proc/self/io', 'utf8');
  const match = /^rchar:\s*(\d+)$/m.exec(io);
  if (!match) {
    throw new Error('rchar not reported');
  }
  return Number(match[1]);
};

const titleMarker = (title: string) =>
  JSON.stringify({ type: 'ai-title', sessionId: SESSION_ID, aiTitle: title });

/** Invokes the private extractor directly; it has no public entry point. */
const extractTitle = (filePath: string): Promise<string | undefined> => {
  const synchronizer = new ClaudeSessionSynchronizer();
  return (
    synchronizer as unknown as {
      extractSessionAiTitleFromEnd: (f: string, s: string) => Promise<string | undefined>;
    }
  ).extractSessionAiTitleFromEnd(filePath, SESSION_ID);
};

before(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'claude-session-title-'));
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test('readFileTail reads only the window, not the whole file', async () => {
  const filePath = await writeTranscript('large.jsonl', 2 * 1024 * 1024, [
    titleMarker('Latest title'),
  ]);
  const { size } = await stat(filePath);
  assert.ok(size > TAIL_WINDOW * 4, 'fixture must be much larger than the window');

  const tail = await readFileTail(filePath, TAIL_WINDOW);
  assert.ok(tail);
  assert.equal(tail.bytesRead, TAIL_WINDOW, 'must read exactly the window, not the file');
  assert.equal(tail.fileSize, size);
  assert.equal(tail.truncated, true);
  assert.ok(tail.bytesRead < size / 30, 'the read must be a small fraction of the file');
});

test('readFileTail never returns a partial first line', async () => {
  const filePath = await writeTranscript('partial.jsonl', 256 * 1024, [
    titleMarker('Trailing title'),
  ]);

  // A window whose start almost certainly lands mid-line.
  const tail = await readFileTail(filePath, 3_333);
  assert.ok(tail);
  assert.equal(tail.truncated, true);

  for (const line of tail.content.split('\n').filter(Boolean)) {
    assert.doesNotThrow(
      () => JSON.parse(line),
      `every returned line must be whole and parseable, got: ${line.slice(0, 40)}`,
    );
  }
});

test('readFileTail on a file smaller than the window returns all of it, untruncated', async () => {
  const filePath = path.join(workDir, 'small.jsonl');
  const body = `${titleMarker('Small file title')}\n`;
  await writeFile(filePath, body, 'utf8');

  const tail = await readFileTail(filePath, TAIL_WINDOW);
  assert.ok(tail);
  assert.equal(tail.truncated, false);
  assert.equal(tail.bytesRead, Buffer.byteLength(body));
  assert.equal(tail.content, body);
});

test('readFileTail returns null for a missing file', async () => {
  assert.equal(await readFileTail(path.join(workDir, 'nope.jsonl'), TAIL_WINDOW), null);
});

/**
 * The equivalence tests below deliberately cannot tell a bounded read from a full
 * one — the whole point of the change is that the answer is unchanged. This one
 * asserts the bound itself, by measuring bytes actually returned to userspace, so
 * that reverting the caller to `readFile()` fails here rather than passing
 * silently. `rchar` counts bytes delivered by read syscalls whether or not the
 * page cache served them; it is Linux-only, so elsewhere this skips.
 */
test('extracting a title does not read the whole transcript', async (t) => {
  try {
    await readProcessReadChars();
  } catch {
    return t.skip('no /proc/self/io on this platform');
  }

  const filePath = await writeTranscript('bounded.jsonl', 8 * 1024 * 1024, [
    titleMarker('Bounded read title'),
  ]);
  const { size } = await stat(filePath);

  const before = await readProcessReadChars();
  assert.equal(await extractTitle(filePath), 'Bounded read title');
  const consumed = (await readProcessReadChars()) - before;

  assert.ok(
    consumed < size / 4,
    `expected a bounded read, but ${consumed} bytes were read from a ${size}-byte file`,
  );
});

test('resolves the newest title from a large transcript', async () => {
  const filePath = await writeTranscript('titled.jsonl', 2 * 1024 * 1024, [
    titleMarker('An earlier title'),
    JSON.stringify({ type: 'assistant', sessionId: SESSION_ID, text: 'after' }),
    titleMarker('The newest title'),
  ]);

  assert.equal(await extractTitle(filePath), 'The newest title');
});

test('a title outside the window is still found, via the full-read fallback', async () => {
  // Marker first, then more than a window of filler after it: the bounded read
  // cannot see it, so this asserts the fallback rather than a silent miss.
  const filler = `${JSON.stringify({
    type: 'assistant',
    sessionId: SESSION_ID,
    text: 'y'.repeat(512),
  })}\n`;
  const filePath = path.join(workDir, 'far-title.jsonl');
  await writeFile(
    filePath,
    `${titleMarker('Far from the end')}\n${filler.repeat(Math.ceil((TAIL_WINDOW * 2) / filler.length))}`,
    'utf8',
  );

  const tail = await readFileTail(filePath, TAIL_WINDOW);
  assert.ok(tail && !tail.content.includes('Far from the end'), 'window must not hold the marker');

  assert.equal(await extractTitle(filePath), 'Far from the end');
});

test('a transcript with no title marker resolves to undefined', async () => {
  const filePath = await writeTranscript('untitled.jsonl', 128 * 1024, []);
  assert.equal(await extractTitle(filePath), undefined);
});

test('a title for a different session is ignored', async () => {
  const filePath = await writeTranscript('other-session.jsonl', 128 * 1024, [
    JSON.stringify({ type: 'ai-title', sessionId: 'someone-else', aiTitle: 'Not mine' }),
  ]);
  assert.equal(await extractTitle(filePath), undefined);
});

test('last-prompt and custom-title markers still resolve', async () => {
  const lastPrompt = await writeTranscript('last-prompt.jsonl', 128 * 1024, [
    JSON.stringify({ type: 'last-prompt', sessionId: SESSION_ID, lastPrompt: 'A prompt' }),
  ]);
  assert.equal(await extractTitle(lastPrompt), 'A prompt');

  const custom = await writeTranscript('custom-title.jsonl', 128 * 1024, [
    JSON.stringify({ type: 'custom-title', sessionId: SESSION_ID, customTitle: 'Renamed' }),
  ]);
  assert.equal(await extractTitle(custom), 'Renamed');
});
