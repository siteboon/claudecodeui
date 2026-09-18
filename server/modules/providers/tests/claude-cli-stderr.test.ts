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

// The URL rule below keys on `user:pass@`. A plain URL -- including one with a
// port, which also contains a colon -- must survive untouched, or the rule
// would blank exactly the addresses a reader needs to see.
test('claude cli stderr: URLs without credentials are left alone', () => {
  for (const line of [
    'GET https://registry.example.com/pkg failed with 503',
    'connect ECONNREFUSED http://127.0.0.1:8080/health',
    'proxy postgres://db.internal:5432/app unreachable',
  ]) {
    const out = formatCliStderrLine(TAG, line);
    assert.equal(out, `[claude-cli-stderr] ${TAG} ${line}`, `wrongly redacted: ${line}`);
  }
});

// Opaque credentials with no recognisable prefix: nothing in the token itself
// marks it as a secret, so the scheme word is the only handle there is.
test('claude cli stderr: opaque bearer and basic credentials are redacted', () => {
  const bearer = formatCliStderrLine(TAG, 'auth: Bearer aGVsbG8td29ybGQtb3BhcXVlLXZhbHVl');
  assert.ok(!bearer.includes('aGVsbG8td29ybGQtb3BhcXVlLXZhbHVl'), bearer);
  // The scheme word survives -- "Bearer <redacted>" still says what kind of
  // credential was involved.
  assert.ok(bearer.includes('Bearer <redacted>'), bearer);

  const basic = formatCliStderrLine(TAG, 'auth: Basic dXNlcjpwYXNzd29yZA==');
  assert.ok(!basic.includes('dXNlcjpwYXNzd29yZA'), basic);
  assert.ok(basic.includes('Basic <redacted>'), basic);
});

// A four-character credential is still a credential. The old `{8,}` floor
// let exactly this shape -- short opaque Basic auth -- through unredacted.
test('claude cli stderr: a short opaque credential is still redacted', () => {
  const out = formatCliStderrLine(TAG, 'auth: Basic dTpw');
  assert.ok(!out.includes('dTpw'), out);
  assert.ok(out.includes('Basic <redacted>'), out);
});

// "Basic" as an ordinary word, not a scheme, must survive. The pattern only
// fires on `Basic`/`Bearer` followed by whitespace and a token; punctuation
// glued directly onto the word never satisfies that, so prose is untouched.
test('claude cli stderr: "Basic" as a plain word in prose is left alone', () => {
  const line = 'This tier supports Basic, Standard, and Pro plans.';
  const out = formatCliStderrLine(TAG, line);
  assert.equal(out, `[claude-cli-stderr] ${TAG} ${line}`, out);
});

// Credentials in URL userinfo. The host is the diagnostic half of the line and
// must survive -- knowing WHICH registry rejected the login is the point.
test('claude cli stderr: URL credentials go, the host stays', () => {
  const out = formatCliStderrLine(TAG, 'npm ERR! https://deploy:hunter2primary@registry.example.com/pkg 401');

  assert.ok(!out.includes('hunter2primary'), out);
  assert.ok(!out.includes('deploy:'), out);
  assert.ok(out.includes('https://<redacted>@registry.example.com/pkg'), out);
});

// A token used AS the username, with no password at all -- a common shape
// for registry/CI credentials (`https://<token>@host`). No colon anywhere in
// the userinfo, so the old mandatory `:pass` group let this straight
// through.
test('claude cli stderr: a username-only URL credential is redacted, the host stays', () => {
  const out = formatCliStderrLine(TAG, 'fetch https://build-token@registry.example/pkg failed');

  assert.ok(!out.includes('build-token'), out);
  assert.ok(out.includes('https://<redacted>@registry.example/pkg'), out);
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

// An oversized, newline-less fragment used to be handed to `emit()` as if it
// were one complete line, then thrown away. That is wrong on both ends: a
// fragment that never got its newline is not a real line (see the PEM tests
// below for what that costs), and resetting to '' meant an operator had no
// way to learn stderr bytes were dropped at all. The fix discards down to a
// short tail instead of to nothing, and announces the discard.
test('claude cli stderr: a newline-less stream does not buffer without bound', () => {
  const seen: string[] = [];
  const overflows: number[] = [];
  const chunker = createCliStderrChunker(
    (line) => seen.push(line),
    32,
    (discardedChars) => overflows.push(discardedChars),
  );

  chunker.push('x'.repeat(20));
  assert.equal(seen.length, 0, 'below the cap it keeps buffering');

  chunker.push('y'.repeat(200));
  assert.equal(seen.length, 0, 'an oversized fragment is discarded, not emitted as a line');
  assert.deepEqual(overflows, [92], '220 buffered chars minus the 128-char tail that is kept');
});

// The counter-direction, and the reason the discard is a tail-keep rather
// than a reset to '': dropping to '' also drops a PEM header that started
// forming right at the cut, so the formatter never turns `insidePem` on for
// the body lines that follow -- they leak in plain text. Keeping a short
// tail across the discard means the header can still complete.
test('claude cli stderr: a PEM header split across the overflow boundary is still detected', () => {
  const seen: string[] = [];
  const chunker = createCliStderrChunker((line) => seen.push(line), 50);
  const format = createCliStderrFormatter(() => 'tag');

  const header = '-----BEGIN PRIVATE KEY-----';
  const headerFirstHalf = header.slice(0, 15);
  const headerSecondHalf = header.slice(15);

  // Push enough filler that the header's first half arrives right at the
  // overflow boundary, with no newline yet -- the exact shape the finding
  // describes.
  chunker.push('x'.repeat(200) + headerFirstHalf);
  assert.equal(seen.length, 0, 'still buffering, nothing to reassemble into a line yet');

  // The rest of the header, plus a key-material body line and the END
  // marker, arrives in the next chunk.
  chunker.push(`${headerSecondHalf}\nMIIEsecretKeyMaterial\n-----END PRIVATE KEY-----\nordinary after\n`);

  const formatted = seen.map((line) => format(line));

  assert.ok(
    formatted[0].includes('<redacted private key>'),
    `the reassembled header line must be recognised as PEM: ${formatted[0]}`,
  );
  assert.ok(
    formatted[1].includes('<redacted private key>'),
    `the body line must be redacted while the block is open: ${formatted[1]}`,
  );
  assert.ok(!formatted.join('\n').includes('MIIEsecretKeyMaterial'), 'the key material itself must not appear');
  assert.equal(formatted[3], '[claude-cli-stderr] tag ordinary after', 'the block must close, not stay stuck open');
});

// The other half of the same fix: an ordinary oversized line -- no PEM
// anywhere near it -- must not start looking like key material just because
// some of it survives the discard, and the run must recover normally once a
// newline finally arrives.
test('claude cli stderr: an ordinary oversized line discards cleanly, without false PEM detection', () => {
  const seen: string[] = [];
  const overflows: number[] = [];
  const chunker = createCliStderrChunker(
    (line) => seen.push(line),
    50,
    (discardedChars) => overflows.push(discardedChars),
  );
  const format = createCliStderrFormatter(() => 'tag');

  chunker.push('z'.repeat(300));
  assert.equal(overflows.length, 1);
  assert.ok(overflows[0] > 0);

  chunker.push('\nordinary diagnostics\n');

  const formatted = seen.map((line) => format(line));
  assert.ok(!formatted.some((line) => line.includes('<redacted private key>')), 'nothing here is PEM');
  assert.equal(formatted[formatted.length - 1], '[claude-cli-stderr] tag ordinary diagnostics');
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
