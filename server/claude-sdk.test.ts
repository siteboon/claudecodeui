import assert from 'node:assert/strict';
import { test } from 'node:test';

// @ts-expect-error claude-sdk.js is JavaScript without types yet
import { mapCliOptionsToSDK } from '@/claude-sdk.js';

const withEnv = (vars: Record<string, string | undefined>, fn: () => void): void => {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

test('mapCliOptionsToSDK forwards ANTHROPIC_BASE_URL via sdkOptions.env (regression)', () => {
  withEnv({ ANTHROPIC_BASE_URL: 'http://localhost:20128/v1' }, () => {
    const sdkOptions = mapCliOptionsToSDK({});
    assert.equal(sdkOptions.env.ANTHROPIC_BASE_URL, 'http://localhost:20128/v1');
  });
});

test('mapCliOptionsToSDK forwards ANTHROPIC_AUTH_TOKEN via sdkOptions.env (regression)', () => {
  withEnv({ ANTHROPIC_AUTH_TOKEN: 'sk-test-token' }, () => {
    const sdkOptions = mapCliOptionsToSDK({});
    assert.equal(sdkOptions.env.ANTHROPIC_AUTH_TOKEN, 'sk-test-token');
  });
});

test('mapCliOptionsToSDK injects X-Preferred-Account header when preferredAccountId is provided', () => {
  withEnv({ ANTHROPIC_CUSTOM_HEADERS: undefined }, () => {
    const sdkOptions = mapCliOptionsToSDK({ preferredAccountId: 'conn-abc' });
    assert.match(sdkOptions.env.ANTHROPIC_CUSTOM_HEADERS ?? '', /^X-Preferred-Account: conn-abc$/);
  });
});

test('mapCliOptionsToSDK does NOT set ANTHROPIC_CUSTOM_HEADERS when preferredAccountId is absent', () => {
  withEnv({ ANTHROPIC_CUSTOM_HEADERS: undefined }, () => {
    const sdkOptions = mapCliOptionsToSDK({});
    assert.equal(sdkOptions.env.ANTHROPIC_CUSTOM_HEADERS, undefined);
  });
});

test('mapCliOptionsToSDK appends X-Preferred-Account to existing ANTHROPIC_CUSTOM_HEADERS', () => {
  withEnv({ ANTHROPIC_CUSTOM_HEADERS: 'X-Existing-Header: foo' }, () => {
    const sdkOptions = mapCliOptionsToSDK({ preferredAccountId: 'conn-xyz' });
    const headers = sdkOptions.env.ANTHROPIC_CUSTOM_HEADERS ?? '';
    assert.match(headers, /X-Existing-Header: foo/);
    assert.match(headers, /X-Preferred-Account: conn-xyz/);
  });
});

test('mapCliOptionsToSDK ignores empty/whitespace preferredAccountId', () => {
  withEnv({ ANTHROPIC_CUSTOM_HEADERS: undefined }, () => {
    const empty = mapCliOptionsToSDK({ preferredAccountId: '' });
    assert.equal(empty.env.ANTHROPIC_CUSTOM_HEADERS, undefined);
    const whitespace = mapCliOptionsToSDK({ preferredAccountId: '   ' });
    assert.equal(whitespace.env.ANTHROPIC_CUSTOM_HEADERS, undefined);
  });
});

test('mapCliOptionsToSDK passes through cwd and permissionMode unchanged when preferredAccountId is set', () => {
  const sdkOptions = mapCliOptionsToSDK({
    preferredAccountId: 'conn-1',
    cwd: '/tmp/project',
    permissionMode: 'acceptEdits',
  });
  assert.equal(sdkOptions.cwd, '/tmp/project');
  assert.equal(sdkOptions.permissionMode, 'acceptEdits');
});
