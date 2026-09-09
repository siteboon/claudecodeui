import assert from 'node:assert/strict';
import test from 'node:test';

import { createVoiceService } from '../voice.service.js';

const endpoints = [
  "https://api.minimax.io/v1/t2a_v2",
  "https://api.minimaxi.com/v1/t2a_v2"
];
const defaultModel = "speech-2.8-hd";
const defaults = {
  baseUrl: endpoints[0],
  apiKey: 'server-key',
  sttModel: '',
  ttsModel: '',
  ttsVoice: '',
};

for (const endpoint of endpoints) {
  test(`synthesizes MiniMax speech through ${new URL(endpoint).hostname}`, async () => {
    let requestedUrl = '';
    let requestedOptions: RequestInit | undefined;
    const service = createVoiceService({
      defaults: { ...defaults, baseUrl: endpoint.replace('/t2a_v2', '/') },
      timeoutMs: 1_000,
      fetchBackend: async (url, options) => {
        requestedUrl = url;
        requestedOptions = options;
        return Response.json({ base_resp: { status_code: 0 }, data: { status: 2, audio: '494433ff' } });
      },
    });

    const result = await service.synthesizeSpeech({ text: 'Read this', overrides: {} });

    assert.equal(requestedUrl, endpoint);
    assert.ok(requestedOptions);
    assert.equal(requestedOptions.method, 'POST');
    assert.equal(new Headers(requestedOptions.headers).get('Authorization'), 'Bearer server-key');
    assert.deepEqual(JSON.parse(String(requestedOptions.body)), {
      model: defaultModel,
      text: 'Read this',
      stream: false,
      output_format: 'hex',
      voice_setting: { voice_id: 'English_expressive_narrator' },
      audio_setting: { format: 'mp3' },
    });
    assert.ok(result.ok);
    assert.equal(result.value.contentType, 'audio/mpeg');
    assert.deepEqual(new Uint8Array(await new Response(result.value.body).arrayBuffer()), new Uint8Array([73, 68, 51, 255]));
  });
}

for (const [format, contentType] of [['wav', 'audio/wav'], ['flac', 'audio/flac'], ['pcm', 'audio/pcm']]) {
  test(`preserves MiniMax request overrides and returns ${format} audio`, async () => {
    let requestedOptions: RequestInit | undefined;
    const service = createVoiceService({
      defaults,
      timeoutMs: 1_000,
      fetchBackend: async (_url, options) => {
        requestedOptions = options;
        return Response.json({ base_resp: { status_code: 0 }, data: { status: 2, audio: '00ff' } });
      },
    });

    const result = await service.synthesizeSpeech({
      text: 'Custom speech',
      overrides: { apiKey: 'request-key', ttsModel: 'custom-speech', ttsVoice: 'custom-voice', ttsFormat: ` ${format} ` },
    });

    assert.ok(requestedOptions);
    assert.equal(new Headers(requestedOptions.headers).get('Authorization'), 'Bearer request-key');
    const body = JSON.parse(String(requestedOptions.body));
    assert.equal(body.model, 'custom-speech');
    assert.deepEqual(body.voice_setting, { voice_id: 'custom-voice' });
    assert.deepEqual(body.audio_setting, { format });
    assert.ok(result.ok);
    assert.equal(result.value.contentType, contentType);
  });
}

for (const payload of [
  { base_resp: { status_code: 1004 }, data: { status: 2, audio: '00' } },
  { data: { status: 2, audio: '00' } },
  { base_resp: { status_code: 0 }, data: { status: 1, audio: '00' } },
  { base_resp: { status_code: 0 }, data: { status: 2, audio: '' } },
  { base_resp: { status_code: 0 }, data: { status: 2, audio: 'a' } },
  { base_resp: { status_code: 0 }, data: { status: 2, audio: 'zz' } },
  { base_resp: { status_code: 0 }, data: { status: 2, audio: 12 } },
  null,
]) {
  test(`rejects an unsuccessful or invalid MiniMax payload: ${JSON.stringify(payload)}`, async () => {
    const service = createVoiceService({
      defaults,
      timeoutMs: 1_000,
      fetchBackend: async () => Response.json(payload),
    });
    const result = await service.synthesizeSpeech({ text: 'Read this', overrides: {} });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 502);
      assert.match(result.error, /MiniMax/);
    }
  });
}

test('rejects malformed MiniMax JSON and preserves HTTP authentication error mapping', async () => {
  for (const response of [new Response('invalid JSON'), new Response('unauthorized', { status: 401 })]) {
    const service = createVoiceService({ defaults, timeoutMs: 1_000, fetchBackend: async () => response });
    const result = await service.synthesizeSpeech({ text: 'Read this', overrides: {} });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 502);
  }
});

test('rejects unsupported MiniMax formats before sending a request', async () => {
  const service = createVoiceService({
    defaults,
    timeoutMs: 1_000,
    fetchBackend: async () => { throw new Error('fetch must not run'); },
  });
  const result = await service.synthesizeSpeech({ text: 'Read this', overrides: { ttsFormat: 'invalid' } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});
