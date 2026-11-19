import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';
import multer from 'multer';

import { createVoiceRouter } from '@/modules/voice/voice.routes.js';
import type { VoiceAudioUpload, VoiceService } from '@/shared/types.js';

test('transcribe route passes the decoded upload filename to the voice service', async () => {
  const uploads: VoiceAudioUpload[] = [];
  const voiceService: VoiceService = {
    getHealth: () => ({ configured: true }),
    transcribe: async ({ audio }) => {
      uploads.push(audio);
      return { ok: true, value: { text: 'hello' } };
    },
    synthesizeSpeech: async () => ({ ok: false, status: 500, error: 'unexpected call' }),
  };

  const app = express().use('/api/voice', createVoiceRouter({
    voiceService,
    parseAudioUpload: multer({ storage: multer.memoryStorage() }).single('audio'),
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    // FormData sends the filename as raw UTF-8 bytes, like the browser does.
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('audio')], { type: 'audio/webm' }), 'запись голоса.webm');
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/voice/transcribe`, { method: 'POST', body: form });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: 'hello' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].fileName, 'запись голоса.webm');
  assert.equal(uploads[0].mimeType, 'audio/webm');
});
