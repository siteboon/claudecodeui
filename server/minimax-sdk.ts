import {
  buildMiniMaxRuntimeEnvironment,
  readMiniMaxSettingsEnvironment,
} from '@/modules/providers/list/minimax/minimax-config.js';
import {
  MINIMAX_MODELS,
  resolveMiniMaxContextWindow,
} from '@/modules/providers/list/minimax/minimax-models.provider.js';
import type { AnyRecord } from '@/shared/types.js';

import { abortClaudeSDKSession, queryClaudeSDK } from './claude-sdk.js';

export async function queryMiniMaxSDK(
  command: string,
  options: AnyRecord = {},
  writer: Parameters<typeof queryClaudeSDK>[2],
): Promise<unknown> {
  const model = typeof options.model === 'string' && options.model.trim()
    ? options.model.trim()
    : MINIMAX_MODELS.DEFAULT;
  const contextWindow = resolveMiniMaxContextWindow(model);
  const settingsEnvironment = await readMiniMaxSettingsEnvironment();
  const environment = buildMiniMaxRuntimeEnvironment(
    model,
    contextWindow,
    process.env,
    settingsEnvironment,
  );

  return queryClaudeSDK(command, { ...options, model }, writer, {
    provider: 'minimax',
    defaultModel: MINIMAX_MODELS.DEFAULT,
    contextWindow,
    environment,
    unsetEnvironment: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  });
}

export const abortMiniMaxSDKSession = abortClaudeSDKSession;
