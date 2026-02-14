/**
 * Centralized Model Definitions
 * Single source of truth for all supported AI models
 */

/**
 * Claude (Anthropic) Models
 *
 * Note: Claude uses two different formats:
 * - SDK format ('sonnet', 'opus') - used by the UI and claude-sdk.js
 * - API format ('claude-sonnet-4.5') - used by slash commands for display
 */
export const CLAUDE_MODELS = {
  // Models in SDK format (what the actual SDK accepts)
  OPTIONS: [
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'opusplan', label: 'Opus Plan' },
    { value: 'sonnet[1m]', label: 'Sonnet [1M]' }
  ],

  DEFAULT: 'sonnet'
};

/**
 * Cursor Models
 */
export const CURSOR_MODELS = {
  OPTIONS: [
    { value: 'gpt-5.2-high', label: 'GPT-5.2 High' },
    { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    { value: 'opus-4.5-thinking', label: 'Claude 4.5 Opus (Thinking)' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1', label: 'GPT-5.1' },
    { value: 'gpt-5.1-high', label: 'GPT-5.1 High' },
    { value: 'composer-1', label: 'Composer 1' },
    { value: 'auto', label: 'Auto' },
    { value: 'sonnet-4.5', label: 'Claude 4.5 Sonnet' },
    { value: 'sonnet-4.5-thinking', label: 'Claude 4.5 Sonnet (Thinking)' },
    { value: 'opus-4.5', label: 'Claude 4.5 Opus' },
    { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    { value: 'gpt-5.1-codex-high', label: 'GPT-5.1 Codex High' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { value: 'gpt-5.1-codex-max-high', label: 'GPT-5.1 Codex Max High' },
    { value: 'opus-4.1', label: 'Claude 4.1 Opus' },
    { value: 'grok', label: 'Grok' }
  ],

  DEFAULT: 'gpt-5'
};

/**
 * Codex (OpenAI) Models
 */
export const CODEX_MODELS = {
  OPTIONS: [
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { value: 'o3', label: 'O3' },
    { value: 'o4-mini', label: 'O4-mini' }
  ],

  DEFAULT: 'gpt-5.2'
};