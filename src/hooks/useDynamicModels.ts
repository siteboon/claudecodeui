import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '../utils/api';
import {
  CLAUDE_MODELS,
  CURSOR_MODELS,
  CODEX_MODELS,
  GEMINI_MODELS,
} from '../../shared/modelConstants';
import type { SessionProvider } from '../types/app';

interface ModelOption {
  value: string;
  label: string;
}

interface ModelConfig {
  OPTIONS: ModelOption[];
  DEFAULT: string;
}

interface DynamicModelsState {
  claude: ModelConfig;
  cursor: ModelConfig;
  codex: ModelConfig;
  gemini: ModelConfig;
  loaded: boolean;
}

// Module-level shared state so all hook consumers share the same data
let shared_state: DynamicModelsState = {
  claude: CLAUDE_MODELS,
  cursor: CURSOR_MODELS,
  codex: CODEX_MODELS,
  gemini: GEMINI_MODELS,
  loaded: false,
};
let fetch_promise: Promise<void> | null = null;
const listeners = new Set<(s: DynamicModelsState) => void>();

function NotifyListeners() {
  for (const fn of listeners) {
    fn(shared_state);
  }
}

// Map proxy "owned_by" values to our provider categories
function MapProviderKey(owned_by: string): string {
  const key = owned_by.toLowerCase();
  if (key.includes('anthropic')) return 'anthropic';
  if (key.includes('google')) return 'google';
  if (key.includes('openai') || key.includes('azure')) return 'openai';
  if (key.includes('xai')) return 'xai';
  return key;
}

function BuildClaudeOptions(
  grouped: Record<string, ModelOption[]>,
): ModelConfig {
  const anthropic_models = grouped['anthropic'] || [];
  if (anthropic_models.length === 0) return CLAUDE_MODELS;
  return {
    OPTIONS: anthropic_models,
    DEFAULT: anthropic_models[0]?.value || CLAUDE_MODELS.DEFAULT,
  };
}

function BuildCodexOptions(
  grouped: Record<string, ModelOption[]>,
): ModelConfig {
  const openai_models = [
    ...(grouped['openai'] || []),
    ...(grouped['xai'] || []),
  ];
  if (openai_models.length === 0) return CODEX_MODELS;
  return {
    OPTIONS: openai_models,
    DEFAULT: openai_models[0]?.value || CODEX_MODELS.DEFAULT,
  };
}

function BuildGeminiOptions(
  grouped: Record<string, ModelOption[]>,
): ModelConfig {
  const google_models = grouped['google'] || [];
  if (google_models.length === 0) return GEMINI_MODELS;
  return {
    OPTIONS: google_models,
    DEFAULT: google_models[0]?.value || GEMINI_MODELS.DEFAULT,
  };
}

function DoFetch(): Promise<void> {
  if (fetch_promise) return fetch_promise;

  fetch_promise = authenticatedFetch('/api/models')
    .then((res) => res.json())
    .then((data) => {
      if (!data.success || !data.dynamic || !data.models) {
        shared_state = { ...shared_state, loaded: true };
        NotifyListeners();
        return;
      }

      const normalized: Record<string, ModelOption[]> = {};
      for (const model of data.models) {
        const key = MapProviderKey(model.provider);
        if (!normalized[key]) normalized[key] = [];
        normalized[key].push({ value: model.id, label: model.name });
      }

      shared_state = {
        claude: BuildClaudeOptions(normalized),
        cursor: CURSOR_MODELS,
        codex: BuildCodexOptions(normalized),
        gemini: BuildGeminiOptions(normalized),
        loaded: true,
      };
      NotifyListeners();
    })
    .catch((err) => {
      console.error('Failed to fetch dynamic models:', err);
      shared_state = { ...shared_state, loaded: true };
      NotifyListeners();
    });

  return fetch_promise;
}

/**
 * Hook to fetch dynamic models from the API proxy.
 * All components using this hook share the same cached state.
 * Falls back to static model constants if the proxy is unavailable.
 */
export function UseDynamicModels() {
  const [state, setState] = useState<DynamicModelsState>(shared_state);

  useEffect(() => {
    listeners.add(setState);
    if (!shared_state.loaded && !fetch_promise) {
      DoFetch();
    }
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const GetModelsForProvider = useCallback(
    (provider: SessionProvider): ModelConfig => {
      switch (provider) {
        case 'claude':
          return state.claude;
        case 'cursor':
          return state.cursor;
        case 'codex':
          return state.codex;
        case 'gemini':
          return state.gemini;
        default:
          return state.claude;
      }
    },
    [state],
  );

  return {
    ...state,
    GetModelsForProvider,
  };
}
