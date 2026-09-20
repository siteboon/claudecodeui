import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANTIGRAVITY_FALLBACK_MODELS,
  parseAntigravityModelsStdout,
} from '@/modules/providers/list/antigravity/antigravity-models.provider.js';

test('parseAntigravityModelsStdout converts agy model lines to model options', () => {
  const models = parseAntigravityModelsStdout(`
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)

legacy-model
`);

  assert.equal(models.DEFAULT, 'gemini-3.8-flash-medium');
  assert.deepEqual(models.OPTIONS, [
    {
      value: 'gemini-3.8-flash-medium',
      label: 'Gemini 3.8 Flash (Medium)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Thinking)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'legacy-model',
      label: 'legacy-model',
      description: 'Antigravity CLI model',
    },
  ]);
});

test('parseAntigravityModelsStdout falls back when agy returns no models', () => {
  assert.deepEqual(parseAntigravityModelsStdout(''), ANTIGRAVITY_FALLBACK_MODELS);
});
