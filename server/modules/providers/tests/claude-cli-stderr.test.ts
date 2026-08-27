import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCliStderrChunker,
  createCliStderrEmitter,
  createCliStderrFormatter,
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
  assert.equal(seen.length, 0, 'nothing may be emitted before the newline');
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
  assert.equal(seen.length, 0, 'below the cap it keeps buffering');

  chunker.push('y'.repeat(20));
  assert.equal(seen.length, 1, 'above the cap it gives up and emits');
  assert.equal(seen[0].length, 40);
});

// --- PEM blocks ------------------------------------------------------------

test('claude cli stderr: a whole PEM block is suppressed, not just its header', () => {
  const out: string[] = [];
  const format = createCliStderrFormatter(() => 'tag');

  const block = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAxKeyMaterialLine1',
    'AAAAB3NzaC1yc2EAAAADAQABAAABgQKeyMaterialLine2',
    '-----END RSA PRIVATE KEY-----',
  ];
  for (const line of block) out.push(format(line));

  assert.equal(out.length, 4);
  for (const line of out) {
    assert.ok(line.includes('<redacted private key>'), `leaked: ${line}`);
  }
  assert.ok(!out.join('\n').includes('MIIEowIBAAKCAQEAxKeyMaterialLine1'));
  assert.ok(!out.join('\n').includes('AAAAB3NzaC1yc2EAAAADAQABAAABgQKeyMaterialLine2'));
});

test('claude cli stderr: output after the END marker is readable again', () => {
  const format = createCliStderrFormatter(() => 'tag');

  format('-----BEGIN PRIVATE KEY-----');
  format('bodyLineThatMustNotAppear');
  format('-----END PRIVATE KEY-----');
  const after = format('Error: ENOENT: no such file or directory');

  assert.equal(after, '[claude-cli-stderr] tag Error: ENOENT: no such file or directory');
  assert.ok(!after.includes('<redacted private key>'));
});

test('claude cli stderr: a one-line PEM block does not swallow what follows', () => {
  const format = createCliStderrFormatter(() => 'tag');

  const oneLine = format('-----BEGIN PRIVATE KEY----- abc -----END PRIVATE KEY-----');
  const after = format('ordinary diagnostics');

  assert.ok(oneLine.includes('<redacted private key>'));
  assert.equal(after, '[claude-cli-stderr] tag ordinary diagnostics');
});

// --- The handover between throttle and PEM state ---------------------------
//
// Two mechanisms, each correct on its own. The bug lived where they meet: the
// formatter used to run only for lines the throttle let through, so a
// suppressed END marker left the block state stuck open for the rest of the
// run. These tests pin both directions — the state must advance for every
// line, and it must still redact what genuinely belongs to the block.

/** Builds an emitter with a hand-driven clock, so a window can be closed
 *  without waiting a real minute. */
function emitterHarness() {
  const written: string[] = [];
  const notices: number[] = [];
  let clock = 1_000;
  const emitter = createCliStderrEmitter({
    format: createCliStderrFormatter(() => 'tag'),
    sink: (text: string) => { written.push(text); },
    throttleNotice: (dropped: number) => { notices.push(dropped); },
    now: () => clock,
  });
  return {
    written,
    notices,
    push: (line: string) => emitter.push(line),
    flushDropped: () => emitter.flushDropped(),
    advance: (ms: number) => { clock += ms; },
  };
}

test('claude cli stderr: a throttled END marker does not redact the rest of the run', () => {
  const h = emitterHarness();

  h.push('-----BEGIN PRIVATE KEY-----');
  // Fill the window. Everything here is inside the block, so it is redacted
  // where it is written at all; the point is that the window ends full.
  for (let i = 0; i < 60; i += 1) h.push(`keyMaterialLine${i}`);
  // This is the line that used to be lost: dropped by the throttle, and with
  // it the state transition that closes the block.
  h.push('-----END PRIVATE KEY-----');

  assert.ok(h.notices.length === 0, 'losses are reported at the window boundary, not before');

  h.advance(61_000);
  h.push('Error: ENOENT: no such file or directory');

  const last = h.written[h.written.length - 1];
  // Exact equality, not "does not contain the placeholder": a weaker assertion
  // would also pass if the formatting drifted.
  assert.equal(last, '[claude-cli-stderr] tag Error: ENOENT: no such file or directory');
  // The dropped lines are still accounted for: 62 pushed (BEGIN + 60 + END),
  // 50 fit in the window, 12 were dropped.
  assert.deepEqual(h.notices, [12]);
});

test('claude cli stderr: a throttled body line stays redacted when the block is still open', () => {
  const h = emitterHarness();

  h.push('-----BEGIN PRIVATE KEY-----');
  for (let i = 0; i < 60; i += 1) h.push(`filler${i}`);
  // Still INSIDE the block — no END marker anywhere. The window rolls over,
  // and the next line must remain suppressed.
  h.advance(61_000);
  h.push('MIIEowIBAAKCAQEAxRealKeyMaterialAfterTheWindow');

  const last = h.written[h.written.length - 1];
  assert.equal(last, '[claude-cli-stderr] tag <redacted private key>');
  assert.ok(!h.written.join('\n').includes('MIIEowIBAAKCAQEAxRealKeyMaterialAfterTheWindow'));
});

test('claude cli stderr: the run-end flush still reports what the throttle swallowed', () => {
  const h = emitterHarness();

  for (let i = 0; i < 60; i += 1) h.push(`line${i}`);
  assert.equal(h.notices.length, 0);

  // The run ends with the window still open; the count must not go to the grave.
  h.flushDropped();
  assert.deepEqual(h.notices, [10]);

  // Flushing twice must not invent a second report.
  h.flushDropped();
  assert.deepEqual(h.notices, [10]);
});

test('claude cli stderr: blank lines are ignored and do not consume the window', () => {
  const h = emitterHarness();

  h.push('   ');
  h.push('');
  h.push('real line');

  assert.deepEqual(h.written, ['[claude-cli-stderr] tag real line']);
});
