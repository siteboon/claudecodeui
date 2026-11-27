import assert from 'node:assert/strict';
import { mkdtemp, readFile, readlink, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { readLinesBackwards } from '@/shared/utils.js';

/**
 * `extractSessionTitle` read the whole transcript with `readFile()` and split
 * it, on every add/change event, for any session without a settled title —
 * allocating a multi-megabyte string plus a full `lines` array each time.
 *
 * It cannot simply read a tail window instead: under the `custom-title` >
 * `ai-title` > `last-prompt` priority, a marker found near EOF does not
 * authorise returning it, because a higher-priority one may sit earlier in the
 * file. So the scan runs *backwards* in chunks, where the first hit of a type
 * is its last occurrence, and only a `custom-title` may stop it.
 *
 * These tests cover the reader's chunk-boundary handling, that the priority is
 * resolved exactly, and — by measurement, not by the returned value — that the
 * `custom-title` early exit really does avoid the rest of the file.
 */

const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const CHUNK = 64 * 1024;

let workDir: string;

/** Builds a JSONL transcript of at least `minBytes`, with `trailing` appended. */
const writeTranscript = async (
  name: string,
  minBytes: number,
  trailing: string[]
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

/** Paths this process currently holds open (Linux). */
const openFilePaths = async (): Promise<string[]> => {
  const entries = await readdir('/proc/self/fd');
  const resolved = await Promise.all(
    entries.map((entry) => readlink(path.join('/proc/self/fd', entry)).catch(() => ''))
  );
  return resolved.filter(Boolean);
};

const collect = async (filePath: string, chunkBytes: number): Promise<string[]> => {
  const lines: string[] = [];
  for await (const line of readLinesBackwards(filePath, chunkBytes)) {
    lines.push(line);
  }
  return lines;
};

const aiTitle = (title: string) =>
  JSON.stringify({ type: 'ai-title', sessionId: SESSION_ID, aiTitle: title });
const customTitle = (title: string) =>
  JSON.stringify({ type: 'custom-title', sessionId: SESSION_ID, customTitle: title });
const lastPrompt = (prompt: string) =>
  JSON.stringify({ type: 'last-prompt', sessionId: SESSION_ID, lastPrompt: prompt });

/** Invokes the private extractor directly; it has no public entry point. */
const extractTitle = (filePath: string): Promise<string | undefined> => {
  const synchronizer = new ClaudeSessionSynchronizer();
  return (
    synchronizer as unknown as {
      extractSessionTitle: (f: string, s: string) => Promise<string | undefined>;
    }
  ).extractSessionTitle(filePath, SESSION_ID);
};

before(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'claude-session-title-'));
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// readLinesBackwards
// --------------------------------------------------------------------------

test('yields whole lines in reverse across many chunk boundaries', async () => {
  const body = Array.from({ length: 500 }, (_, index) => `line-${index}`).join('\n');
  const filePath = path.join(workDir, 'reverse.jsonl');
  await writeFile(filePath, body, 'utf8');

  const { size } = await stat(filePath);
  assert.ok(size > 64 * 8, 'fixture must span many chunks at the size used below');

  assert.deepEqual(await collect(filePath, 64), body.split('\n').reverse());
});

test('a multi-byte character split by a chunk boundary is decoded intact', async () => {
  // Place a 4-byte emoji so that a chunk boundary falls *inside* it, then
  // assert that it really does before trusting the result.
  const head = `${'a'.repeat(100)}\nprefix-`;
  const body = `${head}\u{1F600}-suffix\nlast`;
  const filePath = path.join(workDir, 'boundary.jsonl');
  await writeFile(filePath, body, 'utf8');

  const size = Buffer.byteLength(body);
  const emojiStart = Buffer.byteLength(head);
  const boundary = emojiStart + 2; // two bytes into the four-byte sequence
  const chunkBytes = size - boundary;

  assert.ok(chunkBytes > 0 && chunkBytes < size, 'boundary must fall inside the file');
  assert.ok(
    emojiStart < boundary && boundary < emojiStart + 4,
    'the first chunk boundary must split the emoji, or this test proves nothing'
  );

  assert.deepEqual(await collect(filePath, chunkBytes), body.split('\n').reverse());
});

test('every chunk size reproduces the forward split exactly', async () => {
  // Exhaustive over boundary positions, so no multi-byte split can be missed:
  // 2-, 3- and 4-byte sequences, plus an empty line and a trailing newline.
  const body = 'café\n好好好\n\u{1F600}\u{1F601}\n\nplain\n';
  const filePath = path.join(workDir, 'sweep.jsonl');
  await writeFile(filePath, body, 'utf8');

  const expected = body.split('\n').reverse();
  for (let chunkBytes = 1; chunkBytes <= Buffer.byteLength(body) + 2; chunkBytes += 1) {
    assert.deepEqual(
      await collect(filePath, chunkBytes),
      expected,
      `chunk size ${chunkBytes} did not reproduce the forward split`
    );
  }
});

test('a file smaller than one chunk is returned whole', async () => {
  const body = 'only\ntwo\n';
  const filePath = path.join(workDir, 'small.jsonl');
  await writeFile(filePath, body, 'utf8');

  assert.deepEqual(await collect(filePath, CHUNK), ['', 'two', 'only']);
});

test('a file with no trailing newline keeps its final line', async () => {
  const body = 'first\nsecond\nno-newline-here';
  const filePath = path.join(workDir, 'no-trailing.jsonl');
  await writeFile(filePath, body, 'utf8');

  assert.deepEqual(await collect(filePath, 7), ['no-newline-here', 'second', 'first']);
});

test('an empty file yields nothing', async () => {
  const filePath = path.join(workDir, 'empty.jsonl');
  await writeFile(filePath, '', 'utf8');

  assert.deepEqual(await collect(filePath, CHUNK), []);
});

test('a missing file yields nothing rather than throwing', async () => {
  assert.deepEqual(await collect(path.join(workDir, 'nope.jsonl'), CHUNK), []);
});

test('breaking out of the loop still closes the file handle', async (t) => {
  try {
    await openFilePaths();
  } catch {
    return t.skip('no /proc/self/fd on this platform');
  }

  const filePath = await writeTranscript('early-close.jsonl', 512 * 1024, [aiTitle('Stop here')]);

  for await (const line of readLinesBackwards(filePath, 4 * 1024)) {
    if (line.includes('Stop here')) {
      break;
    }
  }

  assert.ok(
    !(await openFilePaths()).includes(filePath),
    'the handle must be closed when the consumer breaks out early'
  );
});

// --------------------------------------------------------------------------
// extractSessionTitle
// --------------------------------------------------------------------------

test('an ai-title near the start is found behind megabytes of transcript', async () => {
  // The case a tail window gets wrong: `ai-title` is written after the first
  // exchange, so on a long session it is nowhere near EOF.
  const filler = `${JSON.stringify({
    type: 'assistant',
    sessionId: SESSION_ID,
    text: 'y'.repeat(512),
  })}\n`;
  const filePath = path.join(workDir, 'far-title.jsonl');
  await writeFile(
    filePath,
    `${aiTitle('Far from the end')}\n${filler.repeat(Math.ceil((4 * 1024 * 1024) / filler.length))}`,
    'utf8'
  );

  const { size } = await stat(filePath);
  assert.ok(size > CHUNK * 60, 'the marker must sit far outside any plausible tail window');

  assert.equal(await extractTitle(filePath), 'Far from the end');
});

test('custom-title outranks a later ai-title and last-prompt', async () => {
  const filePath = await writeTranscript('priority.jsonl', 128 * 1024, [
    customTitle('Renamed via cli'),
    aiTitle('AI generated title'),
    lastPrompt('first prompt'),
  ]);

  assert.equal(await extractTitle(filePath), 'Renamed via cli');
});

test('ai-title outranks a later last-prompt, and the newest of each type wins', async () => {
  const filePath = await writeTranscript('newest.jsonl', 128 * 1024, [
    aiTitle('An earlier title'),
    aiTitle('The newest title'),
    lastPrompt('a later prompt'),
  ]);

  assert.equal(await extractTitle(filePath), 'The newest title');
});

test('a custom-title stops the scan instead of reading to the start', async (t) => {
  // The returned title is the same whether or not the early exit works, so
  // this asserts the bound by measuring bytes delivered to userspace. `rchar`
  // counts them whether or not the page cache served the read; Linux-only.
  try {
    await readProcessReadChars();
  } catch {
    return t.skip('no /proc/self/io on this platform');
  }

  const filePath = await writeTranscript('early-exit.jsonl', 8 * 1024 * 1024, [
    customTitle('Renamed near the end'),
  ]);
  const { size } = await stat(filePath);

  const before = await readProcessReadChars();
  assert.equal(await extractTitle(filePath), 'Renamed near the end');
  const consumed = (await readProcessReadChars()) - before;

  assert.ok(
    consumed < size / 4,
    `expected the scan to stop early, but ${consumed} bytes were read from a ${size}-byte file`
  );
});

test('markers belonging to another session are ignored', async () => {
  const filePath = await writeTranscript('other-session.jsonl', 128 * 1024, [
    JSON.stringify({ type: 'ai-title', sessionId: 'someone-else', aiTitle: 'Not mine' }),
  ]);

  assert.equal(await extractTitle(filePath), undefined);
});

test('a transcript with no marker resolves to undefined', async () => {
  const filePath = await writeTranscript('untitled.jsonl', 128 * 1024, []);
  assert.equal(await extractTitle(filePath), undefined);
});

test('a last-prompt is used when nothing outranks it', async () => {
  const filePath = await writeTranscript('prompt-only.jsonl', 128 * 1024, [
    lastPrompt('A prompt'),
  ]);

  assert.equal(await extractTitle(filePath), 'A prompt');
});
