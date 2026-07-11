import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANTIGRAVITY_FALLBACK_MODELS,
  parseAntigravityModelsStdout,
} from './antigravity-models.provider.js';

test('parseAntigravityModelsStdout converts agy model lines to model options', () => {
  const models = parseAntigravityModelsStdout(`
Gemini 3.5 Flash (Medium)
Claude Sonnet 4.6 (Thinking)

GPT-OSS 120B (Medium)
`);

  assert.equal(models.DEFAULT, 'Gemini 3.5 Flash (Medium)');
  assert.deepEqual(models.OPTIONS.map((option) => option.value), [
    'Gemini 3.5 Flash (Medium)',
    'Claude Sonnet 4.6 (Thinking)',
    'GPT-OSS 120B (Medium)',
  ]);
});

test('parseAntigravityModelsStdout falls back when agy returns no models', () => {
  assert.deepEqual(parseAntigravityModelsStdout(''), ANTIGRAVITY_FALLBACK_MODELS);
});
