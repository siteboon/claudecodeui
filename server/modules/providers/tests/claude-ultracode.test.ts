import assert from 'node:assert/strict';
import test from 'node:test';

import { CLAUDE_FALLBACK_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { mapCliOptionsToSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';

const effortValuesFor = (model: string): string[] => {
  const option = CLAUDE_FALLBACK_MODELS.OPTIONS.find((candidate) => candidate.value === model);
  return option?.effort?.values.map((value) => value.value) ?? [];
};

test('ultracode effort is offered exactly on xhigh-capable Claude models', () => {
  for (const option of CLAUDE_FALLBACK_MODELS.OPTIONS) {
    const efforts = effortValuesFor(option.value);
    assert.equal(
      efforts.includes('ultracode'),
      efforts.includes('xhigh'),
      `model "${option.value}" should offer ultracode exactly when it offers xhigh`,
    );
  }
});

test('ultracode effort maps to xhigh plus the session-scoped ultracode settings key', () => {
  const sdkOptions = mapCliOptionsToSDK({ model: 'fable', effort: 'ultracode' });

  assert.equal(sdkOptions.effort, 'xhigh');
  assert.deepEqual(sdkOptions.settings, { ultracode: true });
});

test('plain effort levels do not enable ultracode', () => {
  const sdkOptions = mapCliOptionsToSDK({ model: 'fable', effort: 'xhigh' });

  assert.equal(sdkOptions.effort, 'xhigh');
  assert.equal(sdkOptions.settings, undefined);
});

test('ultracode effort is dropped for models that do not offer it', () => {
  for (const model of ['sonnet', 'haiku']) {
    const sdkOptions = mapCliOptionsToSDK({ model, effort: 'ultracode' });

    assert.equal(sdkOptions.effort, undefined, `model "${model}" should not receive an effort`);
    assert.equal(sdkOptions.settings, undefined, `model "${model}" should not receive settings`);
  }
});
