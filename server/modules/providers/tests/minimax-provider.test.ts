import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MINIMAX_ANTHROPIC_ENDPOINTS,
  buildMiniMaxRuntimeEnvironment,
  resolveMiniMaxBaseUrl,
} from '@/modules/providers/list/minimax/minimax-config.js';
import {
  MINIMAX_MODEL_IDS,
  MiniMaxProviderModels,
  isMiniMaxModel,
  resolveMiniMaxContextWindow,
} from '@/modules/providers/list/minimax/minimax-models.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';

test('MiniMax provider exposes the configured text models in priority order', async () => {
  const models = await new MiniMaxProviderModels().getSupportedModels();

  assert.deepEqual(models.OPTIONS.map((option) => option.value), [...MINIMAX_MODEL_IDS]);
  assert.equal(models.DEFAULT, MINIMAX_MODEL_IDS[0]);
  assert.equal(providerRegistry.resolveProvider('minimax').id, 'minimax');
});

test('MiniMax endpoint resolution supports global, China, and explicit endpoints', () => {
  assert.equal(resolveMiniMaxBaseUrl({}), MINIMAX_ANTHROPIC_ENDPOINTS.global);
  assert.equal(resolveMiniMaxBaseUrl({ MINIMAX_REGION: 'cn' }), MINIMAX_ANTHROPIC_ENDPOINTS.cn);
  assert.equal(
    resolveMiniMaxBaseUrl({ MINIMAX_ANTHROPIC_BASE_URL: `${MINIMAX_ANTHROPIC_ENDPOINTS.global}/` }),
    MINIMAX_ANTHROPIC_ENDPOINTS.global,
  );
  assert.equal(
    resolveMiniMaxBaseUrl({}, { ANTHROPIC_BASE_URL: `${MINIMAX_ANTHROPIC_ENDPOINTS.cn}/` }),
    MINIMAX_ANTHROPIC_ENDPOINTS.cn,
  );
});

test('MiniMax runtime environment applies the selected model and context window', () => {
  const contextWindow = resolveMiniMaxContextWindow(MINIMAX_MODEL_IDS[1]);
  const environment = buildMiniMaxRuntimeEnvironment(MINIMAX_MODEL_IDS[1], contextWindow, {});

  assert.equal(environment.ANTHROPIC_BASE_URL, MINIMAX_ANTHROPIC_ENDPOINTS.global);
  assert.equal(environment.ANTHROPIC_MODEL, MINIMAX_MODEL_IDS[1]);
  assert.equal(environment.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '204800');
});

test('MiniMax transcript model detection accepts the configured model variants', () => {
  assert.equal(isMiniMaxModel(MINIMAX_MODEL_IDS[0]), true);
  assert.equal(isMiniMaxModel(`${MINIMAX_MODEL_IDS[0]}[1m]`), true);
  assert.equal(isMiniMaxModel('unrelated-model'), false);
});
