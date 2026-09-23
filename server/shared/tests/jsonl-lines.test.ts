import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { buildLookupMap, extractFirstValidJsonlData, readLines } from '@/shared/utils.js';

// Unicode line/paragraph separators and NEL: valid unescaped inside JSON
// strings, and `readline` on Node 24 treats the first two as line breaks.
const LINE_SEPARATOR = '\u2028';
const PARAGRAPH_SEPARATOR = '\u2029';
const NEXT_LINE = '\u0085';

async function collectLines(source: string | Readable): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of readLines(source)) {
    lines.push(line);
  }
  return lines;
}

async function withTempFile(content: string, runTest: (filePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jsonl-lines-'));
  const filePath = path.join(directory, 'session.jsonl');
  try {
    await writeFile(filePath, content, 'utf8');
    await runTest(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type SessionRow = { sessionId: string; cwd: string };

const extractSessionRow = (parsed: unknown): SessionRow | null => {
  const row = parsed as Record<string, unknown>;
  if (typeof row.sessionId === 'string' && typeof row.cwd === 'string') {
    return { sessionId: row.sessionId, cwd: row.cwd };
  }
  return null;
};

// ---------------------------------------------------------------------------
// readLines
// ---------------------------------------------------------------------------

test('readLines splits only on \\n and \\r\\n, keeping Unicode separators inside a line', async () => {
  const content = [
    `a${LINE_SEPARATOR}b`,
    `c${PARAGRAPH_SEPARATOR}d\r`,
    '',
    `e${NEXT_LINE}f`,
  ].join('\n');

  await withTempFile(content, async (filePath) => {
    assert.deepEqual(await collectLines(filePath), [
      `a${LINE_SEPARATOR}b`,
      `c${PARAGRAPH_SEPARATOR}d`,
      '',
      `e${NEXT_LINE}f`,
    ]);
  });
});

test('readLines yields a trailing line that has no newline, and nothing for an empty file', async () => {
  assert.deepEqual(await collectLines(Readable.from([Buffer.from('one\ntwo')])), ['one', 'two']);
  assert.deepEqual(await collectLines(Readable.from([Buffer.from('one\n')])), ['one']);
  assert.deepEqual(await collectLines(Readable.from([])), []);
});

test('readLines keeps a multi-byte character that is split across chunks', async () => {
  const row = JSON.stringify({ text: `before${LINE_SEPARATOR}after` });
  const bytes = Buffer.from(`${row}\r\n{"next":true}\n`, 'utf8');
  const separatorOffset = bytes.indexOf(Buffer.from(LINE_SEPARATOR, 'utf8'));
  const crOffset = bytes.indexOf('\r');

  // Cut inside the 3-byte U+2028 sequence and between \r and \n.
  const chunks = [
    bytes.subarray(0, separatorOffset + 1),
    bytes.subarray(separatorOffset + 1, separatorOffset + 2),
    bytes.subarray(separatorOffset + 2, crOffset + 1),
    bytes.subarray(crOffset + 1),
  ];

  const lines = await collectLines(Readable.from(chunks));
  assert.deepEqual(lines, [row, '{"next":true}']);
  assert.equal(JSON.parse(lines[0]).text, `before${LINE_SEPARATOR}after`);
});

test('readLines destroys the stream when the caller stops early', async () => {
  await withTempFile('first\nsecond\nthird\n', async (filePath) => {
    const stream = fs.createReadStream(filePath);
    for await (const line of readLines(stream)) {
      assert.equal(line, 'first');
      break;
    }
    assert.equal(stream.destroyed, true);
  });
});

test('readLines throws for a missing file', async () => {
  await assert.rejects(
    collectLines(path.join(os.tmpdir(), 'jsonl-lines-does-not-exist.jsonl')),
    { code: 'ENOENT' },
  );
});

// ---------------------------------------------------------------------------
// extractFirstValidJsonlData / buildLookupMap
// ---------------------------------------------------------------------------

test('extractFirstValidJsonlData skips malformed lines instead of giving up on the file', async () => {
  const content = [
    'not json',
    '{"sessionId":"half-written',
    'null',
    JSON.stringify({ sessionId: 's1', cwd: '/work/repo' }),
  ].join('\n');

  await withTempFile(content, async (filePath) => {
    assert.deepEqual(await extractFirstValidJsonlData(filePath, extractSessionRow), {
      sessionId: 's1',
      cwd: '/work/repo',
    });
  });
});

test('extractFirstValidJsonlData reads a row whose string contains U+2028', async () => {
  const content = [
    JSON.stringify({ sessionId: 's1', cwd: '/work/repo', text: `pasted${LINE_SEPARATOR}text` }),
    JSON.stringify({ sessionId: 's2', cwd: '/work/other' }),
  ].join('\n');

  await withTempFile(content, async (filePath) => {
    assert.deepEqual(await extractFirstValidJsonlData(filePath, extractSessionRow), {
      sessionId: 's1',
      cwd: '/work/repo',
    });
  });
});

test('extractFirstValidJsonlData returns null for a missing file', async () => {
  const missingPath = path.join(os.tmpdir(), 'jsonl-lines-does-not-exist.jsonl');
  assert.equal(await extractFirstValidJsonlData(missingPath, extractSessionRow), null);
});

test('buildLookupMap keeps values containing U+2028 and skips malformed lines', async () => {
  const content = [
    JSON.stringify({ sessionId: 's1', display: `first${LINE_SEPARATOR}prompt` }),
    'not json',
    JSON.stringify({ sessionId: 's2', display: 'second prompt' }),
  ].join('\n');

  await withTempFile(content, async (filePath) => {
    const lookup = await buildLookupMap(filePath, 'sessionId', 'display');
    assert.equal(lookup.get('s1'), `first${LINE_SEPARATOR}prompt`);
    assert.equal(lookup.get('s2'), 'second prompt');
  });
});
