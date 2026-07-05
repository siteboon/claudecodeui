import type { LLMProvider } from '../types/app';

export const ALL_LLM_PROVIDERS: readonly LLMProvider[] = ['claude', 'cursor', 'codex', 'gemini', 'opencode'];

const PROVIDER_SET = new Set<LLMProvider>(ALL_LLM_PROVIDERS);

function readViteEnabledProviders(): string | undefined {
  return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_ENABLED_PROVIDERS;
}

export function getEnabledProviders(rawValue = readViteEnabledProviders()): LLMProvider[] {
  if (!rawValue?.trim()) {
    return [...ALL_LLM_PROVIDERS];
  }

  const enabled = rawValue
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is LLMProvider => PROVIDER_SET.has(provider as LLMProvider));

  return enabled.length > 0 ? Array.from(new Set(enabled)) : [...ALL_LLM_PROVIDERS];
}

export const ENABLED_LLM_PROVIDERS = getEnabledProviders();
