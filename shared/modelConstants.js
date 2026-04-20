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
    { value: "claude-opus-4-7", label: "Opus 4.7" },
    { value: "claude-opus-4-6", label: "Opus 4.6" },
    { value: "opus[1m]", label: "Opus 4.6 (1M context)" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { value: "sonnet[1m]", label: "Sonnet 4.6 (1M context)" },
    { value: "claude-opus-4-5-20251101", label: "Opus 4.5" },
    { value: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
    { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    { value: "opusplan", label: "Opus Plan (Opus + Sonnet)" },
  ],

  DEFAULT: "claude-sonnet-4-6",
};

/**
 * Claude Model Context Windows (in tokens)
 *
 * Standard Claude 4.x models have a 200k context window.
 * The [1m] variants enable the 1M-token context window.
 */
export const CLAUDE_DEFAULT_CONTEXT_WINDOW = 200000;
export const CLAUDE_1M_CONTEXT_WINDOW = 1000000;

/**
 * Returns the context window (in tokens) for a given Claude model identifier.
 *
 * Accepts both the SDK short aliases (e.g. "sonnet", "opus[1m]", "opusplan")
 * and the full API model IDs (e.g. "claude-opus-4-7", "claude-sonnet-4-6").
 * Unknown models fall back to the standard 200k context window.
 *
 * @param {string} model - Model identifier
 * @returns {number} Context window size in tokens
 */
export const getClaudeContextWindow = (model) => {
  if (!model || typeof model !== 'string') {
    return CLAUDE_DEFAULT_CONTEXT_WINDOW;
  }
  const normalized = model.toLowerCase();
  if (normalized.includes('[1m]') || normalized.includes('-1m')) {
    return CLAUDE_1M_CONTEXT_WINDOW;
  }
  return CLAUDE_DEFAULT_CONTEXT_WINDOW;
};

/**
 * Cursor Models
 */
export const CURSOR_MODELS = {
  OPTIONS: [
    { value: "opus-4.6-thinking", label: "Claude 4.6 Opus (Thinking)" },
    { value: "gpt-5.3-codex", label: "GPT-5.3" },
    { value: "gpt-5.2-high", label: "GPT-5.2 High" },
    { value: "gemini-3-pro", label: "Gemini 3 Pro" },
    { value: "opus-4.5-thinking", label: "Claude 4.5 Opus (Thinking)" },
    { value: "gpt-5.2", label: "GPT-5.2" },
    { value: "gpt-5.1", label: "GPT-5.1" },
    { value: "gpt-5.1-high", label: "GPT-5.1 High" },
    { value: "composer-1", label: "Composer 1" },
    { value: "auto", label: "Auto" },
    { value: "sonnet-4.5", label: "Claude 4.5 Sonnet" },
    { value: "sonnet-4.5-thinking", label: "Claude 4.5 Sonnet (Thinking)" },
    { value: "opus-4.5", label: "Claude 4.5 Opus" },
    { value: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
    { value: "gpt-5.1-codex-high", label: "GPT-5.1 Codex High" },
    { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
    { value: "gpt-5.1-codex-max-high", label: "GPT-5.1 Codex Max High" },
    { value: "opus-4.1", label: "Claude 4.1 Opus" },
    { value: "grok", label: "Grok" },
  ],

  DEFAULT: "gpt-5-3-codex",
};

/**
 * Codex (OpenAI) Models
 */
export const CODEX_MODELS = {
  OPTIONS: [
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
    { value: "gpt-5.2", label: "GPT-5.2" },
    { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
    { value: "o3", label: "O3" },
    { value: "o4-mini", label: "O4-mini" },
  ],

  DEFAULT: "gpt-5.4",
};

/**
 * Gemini Models
 */
export const GEMINI_MODELS = {
  OPTIONS: [
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.0-pro-exp", label: "Gemini 2.0 Pro Experimental" },
    {
      value: "gemini-2.0-flash-thinking-exp",
      label: "Gemini 2.0 Flash Thinking",
    },
  ],

  DEFAULT: "gemini-3.1-pro-preview",
};
