import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('OpenClaude model constants', () => {
  test('OPENCLAUDE_MODELS is exported from modelConstants', async () => {
    const { OPENCLAUDE_MODELS } = await import('../../../../../shared/modelConstants.js');
    assert.ok(OPENCLAUDE_MODELS, 'OPENCLAUDE_MODELS should be exported');
    assert.ok(Array.isArray(OPENCLAUDE_MODELS.OPTIONS), 'OPTIONS should be an array');
    assert.ok(OPENCLAUDE_MODELS.OPTIONS.length > 0, 'OPTIONS should have at least one model');
    assert.equal(typeof OPENCLAUDE_MODELS.DEFAULT, 'string', 'DEFAULT should be a string');
  });

  test('OPENCLAUDE_MODELS.OPTIONS have value and label', async () => {
    const { OPENCLAUDE_MODELS } = await import('../../../../../shared/modelConstants.js');
    for (const option of OPENCLAUDE_MODELS.OPTIONS) {
      assert.equal(typeof option.value, 'string', `option.value should be string`);
      assert.equal(typeof option.label, 'string', `option.label should be string`);
      assert.ok(option.value.length > 0, 'value should not be empty');
      assert.ok(option.label.length > 0, 'label should not be empty');
    }
  });

  test('OPENCLAUDE_MODELS.DEFAULT is one of the OPTIONS values', async () => {
    const { OPENCLAUDE_MODELS } = await import('../../../../../shared/modelConstants.js');
    const values = OPENCLAUDE_MODELS.OPTIONS.map((o: { value: string }) => o.value);
    assert.ok(values.includes(OPENCLAUDE_MODELS.DEFAULT), `DEFAULT "${OPENCLAUDE_MODELS.DEFAULT}" should be in OPTIONS`);
  });

  test('PROVIDERS array includes openclaude entry', async () => {
    const { PROVIDERS } = await import('../../../../../shared/modelConstants.js');
    const entry = PROVIDERS.find((p: { id: string }) => p.id === 'openclaude');
    assert.ok(entry, 'PROVIDERS should include an openclaude entry');
    assert.equal(entry.name, 'OpenClaude');
    assert.ok(entry.models, 'openclaude entry should have models');
    assert.ok(Array.isArray(entry.models.OPTIONS), 'models.OPTIONS should be an array');
  });
});
