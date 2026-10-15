import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useVersionCheck } from '@/shared/hooks/useVersionCheck';

/**
 * `CLOUDCLI_DISABLE_UPDATE_CHECK` reaches the browser over `GET /health`, and
 * the hook gates its GitHub poll on the answer. The gate has a silent failure
 * mode: if `healthChecked` never flips to true — for example because the
 * `finally` block that sets it is lost in a refactor — the poll effect returns
 * early forever, no request is ever made, and the "Update available" banner
 * dies for every deployment without an error anywhere.
 *
 * These tests pin both directions of the gate and, just as importantly, that it
 * fails OPEN: an unreachable, hung, or older `/health` must restore the
 * pre-flag behavior rather than mute updates for everyone.
 */

const GITHUB_RELEASE_URL_FRAGMENT = 'api.github.com';
const POLL_INTERVAL_MS = 5 * 60 * 1000;

const githubRelease = {
  tag_name: 'v99.0.0',
  name: 'Release 99.0.0',
  body: 'notes',
  html_url: 'https://example.invalid/releases/latest',
  published_at: '2026-01-01T00:00:00Z',
};

type HealthResponse = { kind: 'json'; body: unknown } | { kind: 'reject' } | { kind: 'pending' };

/**
 * Routes `fetch` by URL so a test can assert on the GitHub poll independently
 * of the `/health` call the hook always makes. Returns the recorded GitHub
 * calls plus a resolver for the deliberately-pending `/health` case.
 */
const installFetchMock = (health: HealthResponse) => {
  const githubCalls: string[] = [];
  let resolveHealth: ((body: unknown) => void) | undefined;

  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);

    if (url.includes(GITHUB_RELEASE_URL_FRAGMENT)) {
      githubCalls.push(url);
      return Promise.resolve({ json: () => Promise.resolve(githubRelease) });
    }

    if (url.includes('/health')) {
      if (health.kind === 'reject') return Promise.reject(new Error('health unreachable'));
      if (health.kind === 'pending') {
        return new Promise((resolve) => {
          resolveHealth = (body) => resolve({ json: () => Promise.resolve(body) });
        });
      }
      return Promise.resolve({ json: () => Promise.resolve(health.body) });
    }

    throw new Error(`unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { githubCalls, resolveHealth: (body: unknown) => resolveHealth?.(body) };
};

/** Lets the mocked fetch promises settle without leaving `act` warnings behind. */
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderVersionCheck = () => renderHook(() => useVersionCheck('siteboon', 'claudecodeui'));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('opt-out reported by /health suppresses the GitHub poll, now and on every interval', async () => {
  const { githubCalls } = installFetchMock({ kind: 'json', body: { updateCheckDisabled: true } });

  renderVersionCheck();
  await flush();

  assert.equal(githubCalls.length, 0);

  // Past the 5-minute poll interval: the gate must hold, not just delay.
  await act(async () => {
    vi.advanceTimersByTime(POLL_INTERVAL_MS + 60 * 1000);
  });
  await flush();

  assert.equal(githubCalls.length, 0);
});

test('without the opt-out the GitHub poll runs on mount and repeats every 5 minutes', async () => {
  const { githubCalls } = installFetchMock({ kind: 'json', body: { updateCheckDisabled: false } });

  renderVersionCheck();
  await flush();

  assert.equal(githubCalls.length, 1);

  await act(async () => {
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
  });
  await flush();

  assert.equal(githubCalls.length, 2);
});

test('an unreachable /health fails open into the pre-flag behavior', async () => {
  const { githubCalls } = installFetchMock({ kind: 'reject' });

  renderVersionCheck();
  await flush();

  assert.equal(githubCalls.length, 1);
});

test('a /health without the field at all (older server, newer bundle) keeps checks on', async () => {
  const { githubCalls } = installFetchMock({
    kind: 'json',
    body: { status: 'ok', installMode: 'npm', version: '1.2.3' },
  });

  renderVersionCheck();
  await flush();

  assert.equal(githubCalls.length, 1);
});

test('nothing is polled or scheduled before /health has answered', async () => {
  const { githubCalls, resolveHealth } = installFetchMock({ kind: 'pending' });

  renderVersionCheck();
  await flush();

  assert.equal(githubCalls.length, 0);

  // No interval may exist yet either, or a slow /health would silently start
  // polling on a schedule the gate never approved.
  await act(async () => {
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
  });
  await flush();

  assert.equal(githubCalls.length, 0);

  await act(async () => {
    resolveHealth({ updateCheckDisabled: false });
  });
  await flush();

  assert.equal(githubCalls.length, 1);
});

test('installMode and restartRequired are still read from /health when the gate is closed', async () => {
  installFetchMock({
    kind: 'json',
    body: { installMode: 'npm', version: '1.2.3', updateCheckDisabled: true },
  });

  const { result } = renderVersionCheck();
  await flush();

  assert.equal(result.current.installMode, 'npm');
  assert.equal(result.current.runningVersion, '1.2.3');
  // __APP_VERSION__ is '0.0.0-test' under vitest, so a running 1.2.3 differs.
  assert.equal(result.current.restartRequired, true);
  assert.equal(result.current.updateAvailable, false);
});
