import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export const MINIMAX_ANTHROPIC_ENDPOINTS = {
  global: 'https://api.minimax.io/anthropic',
  cn: 'https://api.minimaxi.com/anthropic',
} as const;

type MiniMaxEnvironment = Record<string, string | undefined>;

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

export const isMiniMaxBaseUrl = (value: string | undefined): boolean => {
  if (!value?.trim()) {
    return false;
  }

  const normalized = normalizeBaseUrl(value);
  return Object.values(MINIMAX_ANTHROPIC_ENDPOINTS).some(
    (endpoint) => normalizeBaseUrl(endpoint) === normalized,
  );
};

export const resolveMiniMaxBaseUrl = (
  environment: MiniMaxEnvironment = process.env,
  settingsEnvironment: MiniMaxEnvironment = {},
): string => {
  const explicitBaseUrl = readOptionalString(environment.MINIMAX_ANTHROPIC_BASE_URL);
  if (explicitBaseUrl) {
    return normalizeBaseUrl(explicitBaseUrl);
  }

  const existingBaseUrl = readOptionalString(environment.ANTHROPIC_BASE_URL);
  if (existingBaseUrl && isMiniMaxBaseUrl(existingBaseUrl)) {
    return normalizeBaseUrl(existingBaseUrl);
  }

  const settingsBaseUrl = readOptionalString(settingsEnvironment.ANTHROPIC_BASE_URL);
  if (settingsBaseUrl && isMiniMaxBaseUrl(settingsBaseUrl)) {
    return normalizeBaseUrl(settingsBaseUrl);
  }

  return environment.MINIMAX_REGION?.trim().toLowerCase() === 'cn'
    ? MINIMAX_ANTHROPIC_ENDPOINTS.cn
    : MINIMAX_ANTHROPIC_ENDPOINTS.global;
};

export const readMiniMaxSettingsEnvironment = async (): Promise<MiniMaxEnvironment> => {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const settings = readObjectRecord(JSON.parse(await readFile(settingsPath, 'utf8')));
    const environment = readObjectRecord(settings?.env) ?? {};
    return Object.fromEntries(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
};

export const resolveMiniMaxCredential = (
  environment: MiniMaxEnvironment,
  settingsEnvironment: MiniMaxEnvironment = {},
): string | null => {
  const dedicatedKey = readOptionalString(environment.MINIMAX_API_KEY);
  if (dedicatedKey) {
    return dedicatedKey;
  }

  const environmentBaseUrl = readOptionalString(environment.ANTHROPIC_BASE_URL);
  if (isMiniMaxBaseUrl(environmentBaseUrl)) {
    return readOptionalString(environment.ANTHROPIC_AUTH_TOKEN)
      ?? readOptionalString(environment.ANTHROPIC_API_KEY)
      ?? null;
  }

  const settingsBaseUrl = readOptionalString(settingsEnvironment.ANTHROPIC_BASE_URL);
  if (isMiniMaxBaseUrl(settingsBaseUrl)) {
    return readOptionalString(settingsEnvironment.ANTHROPIC_AUTH_TOKEN)
      ?? readOptionalString(settingsEnvironment.ANTHROPIC_API_KEY)
      ?? null;
  }

  return null;
};

export const buildMiniMaxRuntimeEnvironment = (
  model: string,
  contextWindow: number,
  environment: MiniMaxEnvironment,
  settingsEnvironment: MiniMaxEnvironment = {},
): Record<string, string> => {
  const runtimeEnvironment: Record<string, string> = {
    ANTHROPIC_BASE_URL: resolveMiniMaxBaseUrl(environment, settingsEnvironment),
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(contextWindow),
  };
  const credential = resolveMiniMaxCredential(environment, settingsEnvironment);
  if (credential) {
    runtimeEnvironment.ANTHROPIC_AUTH_TOKEN = credential;
  }

  return runtimeEnvironment;
};
