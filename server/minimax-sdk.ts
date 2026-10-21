import {
  buildMiniMaxRuntimeEnvironment,
  readMiniMaxSettingsEnvironment,
  resolveMiniMaxConfiguredModel,
} from '@/modules/providers/list/minimax/minimax-config.js';
import {
  MINIMAX_MODELS,
  MiniMaxProviderModels,
  resolveMiniMaxContextWindow,
} from '@/modules/providers/list/minimax/minimax-models.provider.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import type { AnyRecord } from '@/shared/types.js';

import { abortClaudeSDKSession, queryClaudeSDK } from './claude-sdk.js';

export async function queryMiniMaxSDK(
  command: string,
  options: AnyRecord = {},
  writer: Parameters<typeof queryClaudeSDK>[2],
): Promise<unknown> {
  const settingsEnvironment = await readMiniMaxSettingsEnvironment();
  // Resolve the persisted selection before building model-specific environment
  // overrides, just as the shared runtime resolves the SDK's model argument.
  const model = await providerModelsService.resolveResumeModel(
    'minimax', options.sessionId, options.model,
  ) || (options.sessionId
    ? (await new MiniMaxProviderModels().getCurrentActiveModel(options.sessionId)).model
    : resolveMiniMaxConfiguredModel(process.env, settingsEnvironment))
    || MINIMAX_MODELS.DEFAULT;
  const contextWindow = resolveMiniMaxContextWindow(model);
  const environment = buildMiniMaxRuntimeEnvironment(
    model,
    contextWindow,
    process.env,
    settingsEnvironment,
  );

  const effort = model === 'MiniMax-M3.1-Flash' && (!options.effort || options.effort === 'default')
    ? 'max'
    : options.effort;
  return queryClaudeSDK(command, { ...options, model, effort }, writer, {
    provider: 'minimax',
    defaultModel: MINIMAX_MODELS.DEFAULT,
    contextWindow,
    thinking: model === 'MiniMax-M3.1-Flash' ? { type: 'adaptive' } : undefined,
    environment,
    unsetEnvironment: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  });
}

export const abortMiniMaxSDKSession = abortClaudeSDKSession;
