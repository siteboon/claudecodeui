import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { synthesizeVoice } from '@/shared/api';
import { VOICE_CONFIG_STORAGE_KEY } from '@/shared/voiceConfig';

const endpoints = [
  "https://api.minimax.io/v1/t2a_v2",
  "https://api.minimaxi.com/v1/t2a_v2"
];
const defaultModel = "speech-2.8-hd";

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

for (const endpoint of endpoints) {
  test(`plays MiniMax speech directly from ${new URL(endpoint).hostname}`, async () => {
    localStorage.setItem(VOICE_CONFIG_STORAGE_KEY, JSON.stringify({ baseUrl: endpoint, apiKey: 'voice-key' }));
    localStorage.setItem('auth-token', 'application-token');
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) =>
      Response.json({ base_resp: { status_code: 0 }, data: { status: 2, audio: '494433' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await synthesizeVoice('Read this', controller.signal);

    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, options] = fetchMock.mock.calls[0];
    assert.equal(url, endpoint);
    assert.equal(options?.signal, controller.signal);
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer voice-key');
    assert.equal(JSON.parse(String(options?.body)).model, defaultModel);
    assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([73, 68, 51]));
  });
}

test('surfaces MiniMax application errors instead of playing the JSON response', async () => {
  localStorage.setItem(VOICE_CONFIG_STORAGE_KEY, JSON.stringify({ baseUrl: endpoints[0] }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ base_resp: { status_code: 1004 } })));

  const response = await synthesizeVoice('Read this', new AbortController().signal);

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'MiniMax speech failed (code 1004).' });
});

test('keeps unrelated voice endpoints on their existing speech contract', async () => {
  localStorage.setItem(VOICE_CONFIG_STORAGE_KEY, JSON.stringify({
    baseUrl: 'https://voice.example/v1', ttsModel: 'custom-speech', ttsVoice: 'custom-voice',
  }));
  const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => new Response('audio'));
  vi.stubGlobal('fetch', fetchMock);

  await synthesizeVoice('Read this', new AbortController().signal);

  const [url, options] = fetchMock.mock.calls[0];
  assert.equal(url, 'https://voice.example/v1/audio/speech');
  assert.deepEqual(JSON.parse(String(options?.body)), { model: 'custom-speech', voice: 'custom-voice', input: 'Read this' });
});
