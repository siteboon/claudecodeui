import assert from 'node:assert/strict';

test('modelConstants exports OPENCLAUDE_MODELS', async () => {
  const mod = await import('../../../../shared/modelConstants.js');
  assert.ok(mod.OPENCLAUDE_MODELS, 'Should export OPENCLAUDE_MODELS');
  assert.ok(Array.isArray(mod.OPENCLAUDE_MODELS.OPTIONS), 'OPTIONS should be an array');
  assert.ok(mod.OPENCLAUDE_MODELS.DEFAULT, 'Should have a DEFAULT');
});

test('modelConstants exports CREWAI_MODELS', async () => {
  const mod = await import('../../../../shared/modelConstants.js');
  assert.ok(mod.CREWAI_MODELS, 'Should export CREWAI_MODELS');
  assert.ok(Array.isArray(mod.CREWAI_MODELS.OPTIONS), 'OPTIONS should be an array');
  assert.ok(mod.CREWAI_MODELS.DEFAULT, 'Should have a DEFAULT');
});

test('PROVIDERS array includes openclaude', async () => {
  const mod = await import('../../../../shared/modelConstants.js');
  const ids = mod.PROVIDERS.map((p: { id: string }) => p.id);
  assert.ok(ids.includes('openclaude'), 'PROVIDERS should include openclaude');
});

test('PROVIDERS array includes crewai', async () => {
  const mod = await import('../../../../shared/modelConstants.js');
  const ids = mod.PROVIDERS.map((p: { id: string }) => p.id);
  assert.ok(ids.includes('crewai'), 'PROVIDERS should include crewai');
});
