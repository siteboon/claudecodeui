import assert from 'node:assert/strict';
import test, { afterEach, type TestContext } from 'node:test';

import { enabledProvidersService } from '@/modules/providers/services/enabled-providers.service.js';

/**
 * VITE_ENABLED_PROVIDERS (#349) is read on the server at runtime, because npm
 * installs ship a prebuilt frontend that a build-time value would never reach.
 * These pin the parsing rules the UI relies on: the first listed provider is
 * the default for a new chat, and a value that names nothing usable must not
 * leave the UI without providers.
 */

const ALL_PROVIDERS = ['claude', 'codex', 'cursor', 'opencode'];

const originalValue = process.env.VITE_ENABLED_PROVIDERS;

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env.VITE_ENABLED_PROVIDERS;
  } else {
    process.env.VITE_ENABLED_PROVIDERS = originalValue;
  }
});

/** Runs the parser against one value, capturing what it logs. */
function readWithValue(t: TestContext, rawValue: string | undefined) {
  if (rawValue === undefined) {
    delete process.env.VITE_ENABLED_PROVIDERS;
  } else {
    process.env.VITE_ENABLED_PROVIDERS = rawValue;
  }

  const warn = t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  const providers = enabledProvidersService.getEnabledProviders();
  const warnings = warn.mock.calls.map((call) => String(call.arguments[0]));
  return { providers, warnings };
}

test('an unset variable enables every provider without a warning', (t) => {
  const { providers, warnings } = readWithValue(t, undefined);

  assert.deepEqual(providers, ALL_PROVIDERS);
  assert.deepEqual(warnings, []);
});

test('a single provider is the only one enabled', (t) => {
  const { providers } = readWithValue(t, 'claude');

  assert.deepEqual(providers, ['claude']);
});

test('ids are trimmed, case-insensitive, de-duplicated and keep their listed order', (t) => {
  // Order matters: the first entry is the default provider for a new chat.
  const { providers, warnings } = readWithValue(t, ' Codex , CLAUDE,codex,,claude ');

  assert.deepEqual(providers, ['codex', 'claude']);
  assert.deepEqual(warnings, []);
});

test('a quoted value from .env is read without its quotes', (t) => {
  // server/load-env.ts keeps quotes, so `VITE_ENABLED_PROVIDERS="claude,codex"`
  // in .env arrives quoted; read as ids, the quotes would enable every provider.
  const doubleQuoted = readWithValue(t, '"claude,codex"');
  assert.deepEqual(doubleQuoted.providers, ['claude', 'codex']);
  assert.deepEqual(doubleQuoted.warnings, []);

  const singleQuoted = readWithValue(t, " ' codex ' ");
  assert.deepEqual(singleQuoted.providers, ['codex']);
  assert.deepEqual(singleQuoted.warnings, []);

  // Only a matching pair is a quoted value; anything else is read as written.
  const mismatched = readWithValue(t, `"claude,codex'`);
  assert.deepEqual(mismatched.providers, ALL_PROVIDERS);
  assert.equal(mismatched.warnings.length, 1);
});

test('unknown ids are dropped and named in one warning', (t) => {
  const { providers, warnings } = readWithValue(t, 'foo,cursor,Bar,foo');

  assert.deepEqual(providers, ['cursor']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[WARN\]/);
  assert.match(warnings[0], /foo, bar/);
  assert.doesNotMatch(warnings[0], /every provider stays enabled/);
});

test('a value naming no known provider enables every provider and says so', (t) => {
  const { providers, warnings } = readWithValue(t, 'foo');

  assert.deepEqual(providers, ALL_PROVIDERS);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /foo/);
  assert.match(warnings[0], /every provider stays enabled/);
});

test('an empty value enables every provider', (t) => {
  assert.deepEqual(readWithValue(t, '').providers, ALL_PROVIDERS);
  assert.deepEqual(readWithValue(t, ' , ').providers, ALL_PROVIDERS);
});

test('a misconfigured value is reported once, not on every request', (t) => {
  readWithValue(t, 'claude,typo');
  const { providers, warnings } = readWithValue(t, 'claude,typo');

  assert.deepEqual(providers, ['claude']);
  assert.deepEqual(warnings, []);
});

test('callers cannot change the cached list', (t) => {
  // The first read parses the value; the second is served from the cache, so
  // that is the result a caller could corrupt it through.
  readWithValue(t, 'claude,codex');
  const cached = readWithValue(t, 'claude,codex').providers;
  cached.push('cursor');

  assert.deepEqual(readWithValue(t, 'claude,codex').providers, ['claude', 'codex']);
});
