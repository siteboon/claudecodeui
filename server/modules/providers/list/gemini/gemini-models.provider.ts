import type { IProviderModels } from '@/shared/interfaces.js';
import type { ProviderModelsDefinition } from '@/shared/types.js';

export const GEMINI_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro Experimental' },
    { value: 'gemini-2.0-flash-thinking-exp', label: 'Gemini 2.0 Flash Thinking' },
  ],
  DEFAULT: 'gemini-3.1-pro-preview',
};

export class GeminiProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return GEMINI_FALLBACK_MODELS;
  }
}
