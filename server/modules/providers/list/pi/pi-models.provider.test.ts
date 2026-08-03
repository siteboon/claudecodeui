import assert from 'node:assert/strict';
import test from 'node:test';

import { PiModelsProvider, type PiModelsProbe } from './pi-models.provider.js';

type ModelRow = { provider: string; id: string; contextWindow: number; reasoning: boolean };

const makeProbe = (models: ModelRow[], defaultModel?: string): PiModelsProbe => ({
  async getAvailableModels() {
    return models;
  },
  async getState() {
    return { model: defaultModel };
  },
});

const makeProvider = (probe: PiModelsProbe): PiModelsProvider =>
  new PiModelsProvider({
    async withProbe(fn) {
      return fn(probe);
    },
  });

// T10 — get_available_models probe → canonical 列表 + 默认，reasoning 有 effort。
test('T10 supported models are canonical with reasoning-only effort and state default', async () => {
  const provider = makeProvider(
    makeProbe(
      [
        { provider: 'anthropic', id: 'claude-sonnet', contextWindow: 200000, reasoning: true },
        { provider: 'openai', id: 'gpt-basic', contextWindow: 128000, reasoning: false },
      ],
      'openai/gpt-basic',
    ),
  );

  const catalog = await provider.getSupportedModels();

  assert.deepEqual(
    catalog.OPTIONS.map((o) => o.value),
    ['anthropic/claude-sonnet', 'openai/gpt-basic'],
  );

  const reasoningOption = catalog.OPTIONS.find((o) => o.value === 'anthropic/claude-sonnet');
  const plainOption = catalog.OPTIONS.find((o) => o.value === 'openai/gpt-basic');
  assert.ok(reasoningOption?.effort, 'reasoning model exposes thinking effort');
  assert.ok(reasoningOption.effort.values.length > 0);
  assert.equal(plainOption?.effort, undefined, 'non-reasoning model has no effort');

  assert.equal(catalog.DEFAULT, 'openai/gpt-basic');
});

// T10 变体 — 无 state.model 时回退目录首项。
test('T10 default falls back to first option when state has no model', async () => {
  const provider = makeProvider(
    makeProbe([{ provider: 'anthropic', id: 'claude-a', contextWindow: 1, reasoning: false }]),
  );

  const catalog = await provider.getSupportedModels();
  assert.equal(catalog.DEFAULT, 'anthropic/claude-a');
});

// T11 — 未认证（probe 无模型）→ ERR-PI-NOT-AUTHENTICATED，不冒充空目录。
test('T11 empty probe surfaces PI_NOT_AUTHENTICATED instead of empty catalog', async () => {
  const provider = makeProvider(makeProbe([]));
  await assert.rejects(
    () => provider.getSupportedModels(),
    (err: unknown) => (err as { code?: string }).code === 'PI_NOT_AUTHENTICATED',
  );
});

// T11 — probe 抛错映射为 PI_NOT_AUTHENTICATED。
test('T11 probe failure maps to PI_NOT_AUTHENTICATED', async () => {
  const provider = new PiModelsProvider({
    async withProbe() {
      throw new Error('spawn probe failed');
    },
  });
  await assert.rejects(
    () => provider.getSupportedModels(),
    (err: unknown) => (err as { code?: string }).code === 'PI_NOT_AUTHENTICATED',
  );
});

// getCurrentActiveModel 只读，回退目录默认。
test('getCurrentActiveModel returns catalog default', async () => {
  const provider = makeProvider(
    makeProbe(
      [{ provider: 'anthropic', id: 'claude-a', contextWindow: 1, reasoning: false }],
      'anthropic/claude-a',
    ),
  );
  const active = await provider.getCurrentActiveModel();
  assert.equal(active.model, 'anthropic/claude-a');
});
