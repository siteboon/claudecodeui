import assert from 'node:assert/strict';
import test from 'node:test';

import { mapCliOptionsToSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { buildSpokenLineContract } from '@/modules/providers/list/claude/claude-voice-mode.js';

test('without voiceMode the system prompt is the bare claude_code preset', () => {
  const sdkOptions = mapCliOptionsToSDK({});
  assert.deepEqual(sdkOptions.systemPrompt, { type: 'preset', preset: 'claude_code' });
});

test('voiceMode appends the spoken-line contract to the preset', () => {
  const systemPrompt = mapCliOptionsToSDK({ voiceMode: { language: 'en' } }).systemPrompt as {
    type: string;
    preset: string;
    append?: string;
  };
  assert.equal(systemPrompt.type, 'preset');
  assert.equal(systemPrompt.preset, 'claude_code');
  assert.match(systemPrompt.append ?? '', /exactly one `<spoken>\.\.\.<\/spoken>` block/);
});

test('the block language follows the tag the client sends', () => {
  assert.match(buildSpokenLineContract({ language: 'cs' }) ?? '', /Write the block in Czech,/);
  assert.match(buildSpokenLineContract({ language: 'de-AT' }) ?? '', /Write the block in Austrian German,/);
});

test('a missing or unusable tag falls back to the user\'s own language', () => {
  for (const voiceMode of [true, {}, { language: 'x' }, { language: 'not a tag' }, { language: 42 }]) {
    assert.match(buildSpokenLineContract(voiceMode) ?? '', /Write the block in the language the user writes in\./);
  }
});

test('anything but true or an object leaves voice mode off', () => {
  for (const voiceMode of [undefined, null, false, 'true', 1, ['cs']]) {
    assert.equal(buildSpokenLineContract(voiceMode), null);
  }
});
