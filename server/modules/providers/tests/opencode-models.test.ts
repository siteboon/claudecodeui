import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenCodeProviderModels,
  OPENCODE_PREDEFINED_MODELS,
} from '@/modules/providers/list/opencode/opencode-models.provider.js';

test('OpenCode exposes only the curated predefined catalog', async () => {
  const adapter = new OpenCodeProviderModels();

  assert.deepEqual(await adapter.getSupportedModels(), OPENCODE_PREDEFINED_MODELS);
  assert.equal(
    (await adapter.getCurrentActiveModel()).model,
    OPENCODE_PREDEFINED_MODELS.DEFAULT,
  );
  assert.equal(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.every((option) => option.value.startsWith('opencode/')),
    true,
  );
  assert.equal(OPENCODE_PREDEFINED_MODELS.DEFAULT, 'opencode/gpt-5.6-terra');
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'opencode/claude-opus-5'),
  );
});
