import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { extractFirstValidJsonlData, readJsonlLines } from '@/shared/utils.js';

/** Writes `content` to a fresh temp file, runs `check`, then removes the file. */
async function withJsonlFile(content: string | Buffer, check: (filePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'read-jsonl-lines-'));
  const filePath = path.join(directory, 'transcript.jsonl');
  try {
    await writeFile(filePath, content);
    await check(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function collectLines(filePath: string): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of readJsonlLines(filePath)) {
    lines.push(line);
  }
  return lines;
}

test('a record containing U+2028 or U+2029 stays one line', async () => {
  // JSON.stringify writes both separators unescaped.
  const record = { sessionId: 'test-session-1', text: 'line one\u2028line two\u2029line three' };
  const serialized = JSON.stringify(record);
  assert.ok(serialized.includes('\u2028'), 'the fixture must hold the raw separator');

  await withJsonlFile(`${serialized}\n${JSON.stringify({ next: true })}\n`, async (filePath) => {
    const lines = await collectLines(filePath);

    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), record);
    assert.deepEqual(JSON.parse(lines[1]), { next: true });
  });
});

test('CRLF line endings are stripped like readline with crlfDelay: Infinity', async () => {
  await withJsonlFile('{"a":1}\r\n{"b":2}\r\n', async (filePath) => {
    assert.deepEqual(await collectLines(filePath), ['{"a":1}', '{"b":2}']);
  });
});

test('the last line is read even without a trailing newline', async () => {
  await withJsonlFile('{"a":1}\n{"b":2}', async (filePath) => {
    assert.deepEqual(await collectLines(filePath), ['{"a":1}', '{"b":2}']);
  });
});

test('a final newline does not produce an empty line, a blank middle line does', async () => {
  await withJsonlFile('{"a":1}\n\n{"b":2}\n', async (filePath) => {
    assert.deepEqual(await collectLines(filePath), ['{"a":1}', '', '{"b":2}']);
  });
});

test('an empty file yields no lines', async () => {
  await withJsonlFile('', async (filePath) => {
    assert.deepEqual(await collectLines(filePath), []);
  });
});

test('a multi-byte character split across read chunks is decoded intact', async () => {
  // fs read streams deliver 64 KiB chunks, so the two bytes of "é" straddle
  // the first chunk boundary.
  const longText = `${'a'.repeat(64 * 1024 - 1)}é`;
  const content = Buffer.from(`${longText}\n{"b":"\u2028"}\n`, 'utf8');

  await withJsonlFile(content, async (filePath) => {
    const lines = await collectLines(filePath);

    assert.equal(lines.length, 2);
    assert.equal(lines[0], longText);
    assert.deepEqual(JSON.parse(lines[1]), { b: '\u2028' });
  });
});

test('a missing file rejects the loop', async () => {
  await assert.rejects(
    collectLines(path.join(os.tmpdir(), 'read-jsonl-lines-does-not-exist.jsonl')),
    { code: 'ENOENT' },
  );
});

test('extractFirstValidJsonlData skips a malformed row instead of giving up on the file', async () => {
  const content = [
    '{"sessionId":"test-session-1","cwd":',
    JSON.stringify({ sessionId: 'test-session-1', cwd: '/workspace/demo' }),
  ].join('\n');

  await withJsonlFile(content, async (filePath) => {
    const extracted = await extractFirstValidJsonlData(filePath, (row) => {
      const data = row as Record<string, unknown>;
      return typeof data.cwd === 'string' ? data.cwd : null;
    });

    assert.equal(extracted, '/workspace/demo');
  });
});

test('extractFirstValidJsonlData reads a row that contains U+2028', async () => {
  const content = `${JSON.stringify({ sessionId: 'test-session-1', cwd: '/workspace/demo', text: 'a\u2028b' })}\n`;

  await withJsonlFile(content, async (filePath) => {
    const extracted = await extractFirstValidJsonlData(filePath, (row) => {
      const data = row as Record<string, unknown>;
      return typeof data.cwd === 'string' ? data.cwd : null;
    });

    assert.equal(extracted, '/workspace/demo');
  });
});

test('extractFirstValidJsonlData skips a null row instead of giving up on the file', async () => {
  const content = ['null', JSON.stringify({ sessionId: 'test-session-1', cwd: '/workspace/demo' })].join('\n');

  await withJsonlFile(content, async (filePath) => {
    // Reads fields straight off the row, like the session synchronizers do.
    const extracted = await extractFirstValidJsonlData(filePath, (row) => {
      const data = row as Record<string, unknown>;
      return typeof data.cwd === 'string' ? data.cwd : null;
    });

    assert.equal(extracted, '/workspace/demo');
  });
});

test('extractFirstValidJsonlData passes only JSON object rows to the extractor', async () => {
  const validRow = { sessionId: 'test-session-1', cwd: '/workspace/demo' };
  const content = ['42', '"text"', '["a","b"]', JSON.stringify(validRow)].join('\n');

  await withJsonlFile(content, async (filePath) => {
    const seenRows: unknown[] = [];
    const extracted = await extractFirstValidJsonlData(filePath, (row) => {
      seenRows.push(row);
      const data = row as Record<string, unknown>;
      return typeof data.cwd === 'string' ? data.cwd : null;
    });

    assert.equal(extracted, '/workspace/demo');
    assert.deepEqual(seenRows, [validRow]);
  });
});

test('extractFirstValidJsonlData skips a row the extractor throws on and keeps scanning', async () => {
  const content = [
    JSON.stringify({ sessionId: 'test-session-1', payload: null }),
    JSON.stringify({ sessionId: 'test-session-1', payload: { cwd: '/workspace/demo' } }),
  ].join('\n');

  await withJsonlFile(content, async (filePath) => {
    const extracted = await extractFirstValidJsonlData(filePath, (row) => {
      const data = row as { payload: { cwd: unknown } };
      return typeof data.payload.cwd === 'string' ? data.payload.cwd : null;
    });

    assert.equal(extracted, '/workspace/demo');
  });
});
