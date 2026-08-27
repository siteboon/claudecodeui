import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCliStderrChunker,
  formatCliStderrLine,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';

const TAG = 'abc12345';

// The line this whole channel exists for. If it ever stops passing through
// intact, a run ended by the background-wait ceiling goes back to looking like
// a run that vanished for no reason.
test('claude cli stderr: the wind-down message survives formatting intact', () => {
  const line = 'Background tasks still running after 1800s; terminating. '
    + 'Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.';

  const out = formatCliStderrLine(TAG, line);

  assert.ok(out.startsWith(`[claude-cli-stderr] ${TAG} `));
  assert.ok(out.includes('Background tasks still running after 1800s'));
  assert.ok(out.includes('terminating'));
});

test('claude cli stderr: secret-shaped runs are redacted', () => {
  const cases = [
    'spawn failed: ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz0123',
    'GET https://api.telegram.org/bot123456:AAHfakefaketoken/getUpdates failed',
    'auth header: Bearer ghp_AAAABBBBCCCCDDDDEEEEFFFF0123',
    'env: AWS key AKIAIOSFODNN7EXAMPLE rejected',
  ];

  for (const input of cases) {
    const out = formatCliStderrLine(TAG, input);
    assert.ok(out.includes('<redacted>'), `not redacted: ${input}`);
    assert.ok(!out.includes('sk-ant-abcdefghijklmnopqrstuvwxyz0123'));
    assert.ok(!out.includes('AAHfakefaketoken'));
    assert.ok(!out.includes('ghp_AAAABBBBCCCCDDDDEEEEFFFF0123'));
  }
});

// The counter-direction. A filter that redacts everything is as useless as one
// that redacts nothing — it would quietly destroy the diagnostics this channel
// was opened for.
test('claude cli stderr: ordinary diagnostics pass through untouched', () => {
  const line = 'Error: ENOENT: no such file or directory, open /tmp/does-not-exist';

  const out = formatCliStderrLine(TAG, line);

  assert.equal(out, `[claude-cli-stderr] ${TAG} ${line}`);
  assert.ok(!out.includes('<redacted>'));
});

test('claude cli stderr: long lines are capped, short ones are not', () => {
  const long = 'x'.repeat(4000);
  const short = 'x'.repeat(10);

  const cappedOut = formatCliStderrLine(TAG, long);
  const shortOut = formatCliStderrLine(TAG, short);

  const prefix = `[claude-cli-stderr] ${TAG} `;
  assert.equal(cappedOut.slice(prefix.length).length, 500);
  assert.ok(cappedOut.endsWith('…'));
  assert.equal(shortOut, `${prefix}${short}`);
  assert.ok(!shortOut.endsWith('…'));
});

// Redaction has to run BEFORE truncation. If it ran after, a secret sitting
// across the cut would lose its tail, stop matching the pattern, and the
// visible head would be logged in the clear.
test('claude cli stderr: a secret straddling the cut is still redacted', () => {
  const secret = `sk-ant-${'a'.repeat(60)}`;
  const line = `${'p'.repeat(480)} ${secret}`;

  const out = formatCliStderrLine(TAG, line);

  assert.ok(!out.includes('sk-ant-aaaaaaaaaaaaaaaa'));
  assert.ok(out.includes('<redacted>'));
});

// --- chunk reassembly ------------------------------------------------------
//
// The SDK forwards raw `data` events, so these are the cases that decide
// whether redaction can be bypassed by nothing more than unlucky timing.

test('claude cli stderr: a line split across chunks is reassembled', () => {
  const seen: string[] = [];
  const chunker = createCliStderrChunker((line) => seen.push(line));

  chunker.push('Error: ENOENT: no such ');
  assert.deepEqual(seen, [], 'nothing may be emitted before the newline');
  chunker.push('file or directory\n');

  assert.deepEqual(seen, ['Error: ENOENT: no such file or directory']);
});

test('claude cli stderr: a secret split across chunks is still redacted', () => {
  const seen: string[] = [];
  const chunker = createCliStderrChunker((line) => seen.push(formatCliStderrLine('tag', line)));

  // Neither half matches the pattern on its own — that is the whole point.
  chunker.push('auth: sk-ant-abcdefgh');
  chunker.push('ijklmnopqrstuvwxyz0123\n');

  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes('<redacted>'));
  assert.ok(!seen[0].includes('sk-ant-abcdefghijklmnopqrstuvwxyz0123'));
});

test('claude cli stderr: several lines in one chunk all come through', () => {
  const seen: string[] = [];
  const chunker = createCliStderrChunker((line) => seen.push(line));

  chunker.push('one\ntwo\nthree\n');

  assert.deepEqual(seen, ['one', 'two', 'three']);
});

test('claude cli stderr: the trailing fragment is flushed, not lost', () => {
  const seen: string[] = [];
  const chunker = createCliStderrChunker((line) => seen.push(line));

  chunker.push('a complete line\nand a dangling one');
  assert.deepEqual(seen, ['a complete line']);

  chunker.flush();
  assert.deepEqual(seen, ['a complete line', 'and a dangling one']);

  // Flushing twice must not emit the fragment again.
  chunker.flush();
  assert.equal(seen.length, 2);
});

test('claude cli stderr: a newline-less stream does not buffer without bound', () => {
  const seen: string[] = [];
  const chunker = createCliStderrChunker((line) => seen.push(line), 32);

  chunker.push('x'.repeat(20));
  assert.deepEqual(seen, [], 'below the cap it keeps buffering');

  chunker.push('y'.repeat(20));
  assert.equal(seen.length, 1, 'above the cap it gives up and emits');
  assert.equal(seen[0].length, 40);
});
