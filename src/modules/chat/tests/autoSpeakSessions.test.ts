import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

/**
 * The setting is optimistic locally and authoritative on the server, so what
 * matters is that a burst of toggles leaves both in the state the user chose
 * last.
 */

type Write = { enabled: boolean; resolve: () => void };

const writes: Write[] = [];
const settled: boolean[] = [];
let failNextWrite = false;

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionAutoSpeak: () => Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { autoSpeak: false } }),
      }),
      setSessionAutoSpeak: (_sessionId: string, enabled: boolean) => {
        const ok = !failNextWrite;
        failNextWrite = false;
        return new Promise((resolve) => {
          writes.push({
            enabled,
            resolve: () => {
              settled.push(enabled);
              resolve({ ok, status: ok ? 200 : 500, json: async () => ({ success: ok }) });
            },
          });
        });
      },
    },
  },
}));

const { autoSpeakSessions } = await import('@/modules/chat/utils/autoSpeakSessions');

/** Lets the queued write reach the api layer, which it does a microtask later. */
const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  writes.length = 0;
  settled.length = 0;
  failNextWrite = false;
});

test('a second toggle waits for the first, so the server keeps the newest value', async () => {
  const first = autoSpeakSessions.set('session-order', true);
  const second = autoSpeakSessions.set('session-order', false);
  await tick();

  // Only one request is in flight: without this the two race and the server
  // keeps whichever reply lands last.
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.enabled, true);

  writes[0]?.resolve();
  await first;
  await tick();

  assert.equal(writes.length, 2);
  writes[1]?.resolve();
  await second;

  assert.deepEqual(settled, [true, false]);
  assert.equal(autoSpeakSessions.isEnabled('session-order'), false);
});

test('an older failed write does not discard a newer toggle', async () => {
  failNextWrite = true;
  const first = autoSpeakSessions.set('session-fail', false);
  const second = autoSpeakSessions.set('session-fail', true);
  await tick();

  writes[0]?.resolve();
  await first;
  await tick();

  // The failure drops the cache only when it is still the latest write, so the
  // "on" the user chose afterwards survives.
  assert.equal(autoSpeakSessions.isEnabled('session-fail'), true);

  writes[1]?.resolve();
  await second;

  assert.equal(autoSpeakSessions.isEnabled('session-fail'), true);
});
