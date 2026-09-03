import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  fetchCodexQuota,
  resetCodexQuotaCache,
} from '../list/codex/codex-quota.provider.js';

function createAppServer(
  rateLimitResult: unknown,
  requests: Array<Record<string, unknown>>,
): ChildProcess {
  const processEvents = new EventEmitter() as ChildProcess;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let inputBuffer = '';

  Object.assign(processEvents, {
    stdin,
    stdout,
    stderr,
    kill: () => true,
  });

  stdin.on('data', (chunk) => {
    inputBuffer += chunk.toString();
    let newlineIndex = inputBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = inputBuffer.slice(0, newlineIndex);
      inputBuffer = inputBuffer.slice(newlineIndex + 1);
      newlineIndex = inputBuffer.indexOf('\n');
      const request = JSON.parse(line) as Record<string, unknown>;
      requests.push(request);

      if (request.id === 'cloudcli-quota-initialize') {
        stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`);
      } else if (request.id === 'cloudcli-quota-read') {
        stdout.write(`${JSON.stringify({ id: request.id, result: rateLimitResult })}\n`);
      }
    }
  });

  return processEvents;
}

const rateLimitResponse = {
  rateLimits: {
    limitId: 'codex',
    limitName: 'Codex models',
    planType: 'plus',
    primary: {
      usedPercent: 25,
      windowDurationMins: 300,
      resetsAt: 1_800_000_000,
    },
    secondary: {
      usedPercent: 60,
      windowDurationMins: 10_080,
      resetsAt: 1_800_604_800,
    },
  },
};

test('fetchCodexQuota performs the app-server handshake and normalizes both windows', async () => {
  resetCodexQuotaCache();
  const requests: Array<Record<string, unknown>> = [];

  const quota = await fetchCodexQuota(
    {},
    {
      startAppServer: () => createAppServer(rateLimitResponse, requests),
      now: () => 1_000,
    },
  );

  assert.deepEqual(requests.map((request) => request.method), [
    'initialize',
    'initialized',
    'account/rateLimits/read',
  ]);
  assert.ok(quota);
  assert.equal(quota.updatedAt, '1970-01-01T00:00:01.000Z');
  assert.equal(quota.groups[0].name, 'Codex models');
  assert.equal(quota.groups[0].description, 'Codex plus plan');
  assert.deepEqual(
    quota.groups[0].buckets.map((bucket) => ({
      window: bucket.window,
      remainingFraction: bucket.remainingFraction,
      resetTime: bucket.resetTime,
    })),
    [
      {
        window: '5h',
        remainingFraction: 0.75,
        resetTime: '2027-01-15T08:00:00.000Z',
      },
      {
        window: 'weekly',
        remainingFraction: 0.4,
        resetTime: '2027-01-22T08:00:00.000Z',
      },
    ],
  );
});

test('fetchCodexQuota prefers the multi-limit response without duplicating its legacy mirror', async () => {
  resetCodexQuotaCache();
  const requests: Array<Record<string, unknown>> = [];
  const quota = await fetchCodexQuota(
    {},
    {
      startAppServer: () => createAppServer({
        ...rateLimitResponse,
        rateLimitsByLimitId: {
          codex: rateLimitResponse.rateLimits,
          review: {
            limitId: 'review',
            limitName: 'Code review',
            primary: { usedPercent: 10, windowDurationMins: 300 },
          },
        },
      }, requests),
      now: () => 2_000,
    },
  );

  assert.ok(quota);
  assert.deepEqual(quota.groups.map((group) => group.name), ['Codex models', 'Code review']);
});

test('fetchCodexQuota caches reads, supports forced refresh, and tolerates empty data', async () => {
  resetCodexQuotaCache();
  let processCount = 0;
  let response: unknown = rateLimitResponse;
  const startAppServer = () => {
    processCount += 1;
    return createAppServer(response, []);
  };
  const dependencies = { startAppServer, now: () => 10_000 };

  assert.ok(await fetchCodexQuota({}, dependencies));
  assert.ok(await fetchCodexQuota({}, dependencies));
  assert.equal(processCount, 1);

  response = { rateLimits: {} };
  assert.equal(await fetchCodexQuota({ forceRefresh: true }, dependencies), null);
  assert.equal(processCount, 2);
});

test('fetchCodexQuota propagates app-server startup failures for the API error state', async () => {
  resetCodexQuotaCache();
  await assert.rejects(
    () => fetchCodexQuota(
      {},
      {
        startAppServer: () => { throw new Error('Codex is unavailable'); },
        now: () => 10_000,
      },
    ),
    /Codex is unavailable/,
  );
});
