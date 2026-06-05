/**
 * Documentation Model Definitions
 * Used by README links and the public API docs.
 */

/**
 * Claude (Anthropic) Models
 */
export const CLAUDE_MODELS = {
  OPTIONS: [
    {
      value: "default",
      label: "Default (recommended)",
      description: "Use the default model (currently Opus 4.8 (1M context)) · $5/$25 per Mtok",
    },
    {
      value: "sonnet",
      label: "Sonnet",
      description: "Sonnet 4.6 · Best for everyday tasks · $3/$15 per Mtok",
    },
    {
      value: "sonnet[1m]",
      label: "Sonnet (1M context)",
      description: "Sonnet 4.6 for long sessions · $3/$15 per Mtok",
    },
    {
      value: "haiku",
      label: "Haiku",
      description: "Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok",
    },
  ],

  DEFAULT: "default",
};

/**
 * Cursor Models
 */
export const CURSOR_MODELS = {
  OPTIONS: [
    { value: "auto", label: "auto", description: "Auto" },
    {
      value: "composer-2-fast",
      label: "composer-2-fast",
      description: "Composer 2 Fast",
    },
    {
      value: "composer-2",
      label: "composer-2",
      description: "Composer 2",
    },
    {
      value: "gpt-5.3-codex-low",
      label: "gpt-5.3-codex-low",
      description: "Codex 5.3 Low",
    },
    {
      value: "gpt-5.3-codex-low-fast",
      label: "gpt-5.3-codex-low-fast",
      description: "Codex 5.3 Low Fast",
    },
    {
      value: "gpt-5.3-codex",
      label: "gpt-5.3-codex",
      description: "Codex 5.3",
    },
    {
      value: "gpt-5.3-codex-fast",
      label: "gpt-5.3-codex-fast",
      description: "Codex 5.3 Fast",
    },
    {
      value: "gpt-5.3-codex-high",
      label: "gpt-5.3-codex-high",
      description: "Codex 5.3 High",
    },
    {
      value: "gpt-5.3-codex-high-fast",
      label: "gpt-5.3-codex-high-fast",
      description: "Codex 5.3 High Fast",
    },
    {
      value: "gpt-5.3-codex-xhigh",
      label: "gpt-5.3-codex-xhigh",
      description: "Codex 5.3 Extra High",
    },
    {
      value: "gpt-5.3-codex-xhigh-fast",
      label: "gpt-5.3-codex-xhigh-fast",
      description: "Codex 5.3 Extra High Fast",
    },
    { value: "gpt-5.2", label: "gpt-5.2", description: "GPT-5.2" },
    {
      value: "gpt-5.2-codex-low",
      label: "gpt-5.2-codex-low",
      description: "Codex 5.2 Low",
    },
    {
      value: "gpt-5.2-codex-low-fast",
      label: "gpt-5.2-codex-low-fast",
      description: "Codex 5.2 Low Fast",
    },
    {
      value: "gpt-5.2-codex",
      label: "gpt-5.2-codex",
      description: "Codex 5.2",
    },
    {
      value: "gpt-5.2-codex-fast",
      label: "gpt-5.2-codex-fast",
      description: "Codex 5.2 Fast",
    },
    {
      value: "gpt-5.2-codex-high",
      label: "gpt-5.2-codex-high",
      description: "Codex 5.2 High",
    },
    {
      value: "gpt-5.2-codex-high-fast",
      label: "gpt-5.2-codex-high-fast",
      description: "Codex 5.2 High Fast",
    },
    {
      value: "gpt-5.2-codex-xhigh",
      label: "gpt-5.2-codex-xhigh",
      description: "Codex 5.2 Extra High",
    },
    {
      value: "gpt-5.2-codex-xhigh-fast",
      label: "gpt-5.2-codex-xhigh-fast",
      description: "Codex 5.2 Extra High Fast",
    },
    {
      value: "gpt-5.1-codex-max-low",
      label: "gpt-5.1-codex-max-low",
      description: "Codex 5.1 Max Low",
    },
    {
      value: "gpt-5.1-codex-max-low-fast",
      label: "gpt-5.1-codex-max-low-fast",
      description: "Codex 5.1 Max Low Fast",
    },
    {
      value: "gpt-5.1-codex-max-medium",
      label: "gpt-5.1-codex-max-medium",
      description: "Codex 5.1 Max",
    },
    {
      value: "gpt-5.1-codex-max-medium-fast",
      label: "gpt-5.1-codex-max-medium-fast",
      description: "Codex 5.1 Max Medium Fast",
    },
    {
      value: "gpt-5.1-codex-max-high",
      label: "gpt-5.1-codex-max-high",
      description: "Codex 5.1 Max High",
    },
    {
      value: "gpt-5.1-codex-max-high-fast",
      label: "gpt-5.1-codex-max-high-fast",
      description: "Codex 5.1 Max High Fast",
    },
    {
      value: "gpt-5.1-codex-max-xhigh",
      label: "gpt-5.1-codex-max-xhigh",
      description: "Codex 5.1 Max Extra High",
    },
    {
      value: "gpt-5.1-codex-max-xhigh-fast",
      label: "gpt-5.1-codex-max-xhigh-fast",
      description: "Codex 5.1 Max Extra High Fast",
    },
    {
      value: "composer-2.5",
      label: "composer-2.5",
      description: "Composer 2.5",
    },
    {
      value: "gpt-5.5-high",
      label: "gpt-5.5-high",
      description: "GPT-5.5 1M High",
    },
    {
      value: "gpt-5.5-high-fast",
      label: "gpt-5.5-high-fast",
      description: "GPT-5.5 High Fast",
    },
    {
      value: "claude-opus-4-7-thinking-high",
      label: "claude-opus-4-7-thinking-high",
      description: "Opus 4.7 1M High Thinking",
    },
    {
      value: "gpt-5.4-high",
      label: "gpt-5.4-high",
      description: "GPT-5.4 1M High",
    },
    {
      value: "gpt-5.4-high-fast",
      label: "gpt-5.4-high-fast",
      description: "GPT-5.4 High Fast",
    },
    {
      value: "claude-4.6-opus-high-thinking",
      label: "claude-4.6-opus-high-thinking",
      description: "Opus 4.6 1M Thinking",
    },
    {
      value: "claude-4.6-opus-high-thinking-fast",
      label: "claude-4.6-opus-high-thinking-fast",
      description: "Opus 4.6 1M Thinking Fast",
    },
    {
      value: "composer-2.5-fast",
      label: "composer-2.5-fast",
      description: "Composer 2.5 Fast",
    },
    {
      value: "gpt-5.5-none",
      label: "gpt-5.5-none",
      description: "GPT-5.5 1M None",
    },
    {
      value: "gpt-5.5-none-fast",
      label: "gpt-5.5-none-fast",
      description: "GPT-5.5 None Fast",
    },
    {
      value: "gpt-5.5-low",
      label: "gpt-5.5-low",
      description: "GPT-5.5 1M Low",
    },
    {
      value: "gpt-5.5-low-fast",
      label: "gpt-5.5-low-fast",
      description: "GPT-5.5 Low Fast",
    },
    {
      value: "gpt-5.5-medium",
      label: "gpt-5.5-medium",
      description: "GPT-5.5 1M",
    },
    {
      value: "gpt-5.5-medium-fast",
      label: "gpt-5.5-medium-fast",
      description: "GPT-5.5 Fast",
    },
    {
      value: "gpt-5.5-extra-high",
      label: "gpt-5.5-extra-high",
      description: "GPT-5.5 1M Extra High",
    },
    {
      value: "gpt-5.5-extra-high-fast",
      label: "gpt-5.5-extra-high-fast",
      description: "GPT-5.5 Extra High Fast",
    },
    {
      value: "claude-4.6-sonnet-medium",
      label: "claude-4.6-sonnet-medium",
      description: "Sonnet 4.6 1M",
    },
    {
      value: "claude-4.6-sonnet-medium-thinking",
      label: "claude-4.6-sonnet-medium-thinking",
      description: "Sonnet 4.6 1M Thinking",
    },
    {
      value: "claude-opus-4-7-low",
      label: "claude-opus-4-7-low",
      description: "Opus 4.7 1M Low",
    },
    {
      value: "claude-opus-4-7-low-fast",
      label: "claude-opus-4-7-low-fast",
      description: "Opus 4.7 1M Low Fast",
    },
    {
      value: "claude-opus-4-7-medium",
      label: "claude-opus-4-7-medium",
      description: "Opus 4.7 1M Medium",
    },
    {
      value: "claude-opus-4-7-medium-fast",
      label: "claude-opus-4-7-medium-fast",
      description: "Opus 4.7 1M Medium Fast",
    },
    {
      value: "claude-opus-4-7-high",
      label: "claude-opus-4-7-high",
      description: "Opus 4.7 1M High",
    },
    {
      value: "claude-opus-4-7-high-fast",
      label: "claude-opus-4-7-high-fast",
      description: "Opus 4.7 1M High Fast",
    },
    {
      value: "claude-opus-4-7-xhigh",
      label: "claude-opus-4-7-xhigh",
      description: "Opus 4.7 1M",
    },
    {
      value: "claude-opus-4-7-xhigh-fast",
      label: "claude-opus-4-7-xhigh-fast",
      description: "Opus 4.7 1M Fast",
    },
    {
      value: "claude-opus-4-7-max",
      label: "claude-opus-4-7-max",
      description: "Opus 4.7 1M Max",
    },
    {
      value: "claude-opus-4-7-max-fast",
      label: "claude-opus-4-7-max-fast",
      description: "Opus 4.7 1M Max Fast",
    },
    {
      value: "claude-opus-4-7-thinking-low",
      label: "claude-opus-4-7-thinking-low",
      description: "Opus 4.7 1M Low Thinking",
    },
    {
      value: "claude-opus-4-7-thinking-low-fast",
      label: "claude-opus-4-7-thinking-low-fast",
      description: "Opus 4.7 1M Low Thinking Fast",
    },
    {
      value: "claude-opus-4-7-thinking-medium",
      label: "claude-opus-4-7-thinking-medium",
      description: "Opus 4.7 1M Medium Thinking",
    },
    {
      value: "claude-opus-4-7-thinking-medium-fast",
      label: "claude-opus-4-7-thinking-medium-fast",
      description: "Opus 4.7 1M Medium Thinking Fast",
    },
    {
      value: "claude-opus-4-7-thinking-high-fast",
      label: "claude-opus-4-7-thinking-high-fast",
      description: "Opus 4.7 1M High Thinking Fast",
    },
    {
      value: "claude-opus-4-7-thinking-xhigh",
      label: "claude-opus-4-7-thinking-xhigh",
      description: "Opus 4.7 1M Thinking",
    },
    {
      value: "claude-opus-4-7-thinking-xhigh-fast",
      label: "claude-opus-4-7-thinking-xhigh-fast",
      description: "Opus 4.7 1M Thinking Fast",
    },
    {
      value: "claude-opus-4-7-thinking-max",
      label: "claude-opus-4-7-thinking-max",
      description: "Opus 4.7 1M Max Thinking",
    },
    {
      value: "claude-opus-4-7-thinking-max-fast",
      label: "claude-opus-4-7-thinking-max-fast",
      description: "Opus 4.7 1M Max Thinking Fast",
    },
    {
      value: "grok-build-0.1",
      label: "grok-build-0.1",
      description: "Grok Build 0.1 1M",
    },
    {
      value: "gpt-5.4-low",
      label: "gpt-5.4-low",
      description: "GPT-5.4 1M Low",
    },
    {
      value: "gpt-5.4-medium",
      label: "gpt-5.4-medium",
      description: "GPT-5.4 1M",
    },
    {
      value: "gpt-5.4-medium-fast",
      label: "gpt-5.4-medium-fast",
      description: "GPT-5.4 Fast",
    },
    {
      value: "gpt-5.4-xhigh",
      label: "gpt-5.4-xhigh",
      description: "GPT-5.4 1M Extra High",
    },
    {
      value: "gpt-5.4-xhigh-fast",
      label: "gpt-5.4-xhigh-fast",
      description: "GPT-5.4 Extra High Fast",
    },
    {
      value: "claude-4.6-opus-high",
      label: "claude-4.6-opus-high",
      description: "Opus 4.6 1M",
    },
    {
      value: "claude-4.6-opus-max",
      label: "claude-4.6-opus-max",
      description: "Opus 4.6 1M Max",
    },
    {
      value: "claude-4.6-opus-max-thinking",
      label: "claude-4.6-opus-max-thinking",
      description: "Opus 4.6 1M Max Thinking",
    },
    {
      value: "claude-4.6-opus-max-thinking-fast",
      label: "claude-4.6-opus-max-thinking-fast",
      description: "Opus 4.6 1M Max Thinking Fast",
    },
    {
      value: "claude-4.5-opus-high",
      label: "claude-4.5-opus-high",
      description: "Opus 4.5",
    },
    {
      value: "claude-4.5-opus-high-thinking",
      label: "claude-4.5-opus-high-thinking",
      description: "Opus 4.5 Thinking",
    },
    {
      value: "gpt-5.2-low",
      label: "gpt-5.2-low",
      description: "GPT-5.2 Low",
    },
    {
      value: "gpt-5.2-low-fast",
      label: "gpt-5.2-low-fast",
      description: "GPT-5.2 Low Fast",
    },
    {
      value: "gpt-5.2-fast",
      label: "gpt-5.2-fast",
      description: "GPT-5.2 Fast",
    },
    {
      value: "gpt-5.2-high",
      label: "gpt-5.2-high",
      description: "GPT-5.2 High",
    },
    {
      value: "gpt-5.2-high-fast",
      label: "gpt-5.2-high-fast",
      description: "GPT-5.2 High Fast",
    },
    {
      value: "gpt-5.2-xhigh",
      label: "gpt-5.2-xhigh",
      description: "GPT-5.2 Extra High",
    },
    {
      value: "gpt-5.2-xhigh-fast",
      label: "gpt-5.2-xhigh-fast",
      description: "GPT-5.2 Extra High Fast",
    },
    {
      value: "gemini-3.1-pro",
      label: "gemini-3.1-pro",
      description: "Gemini 3.1 Pro",
    },
    {
      value: "gpt-5.4-mini-none",
      label: "gpt-5.4-mini-none",
      description: "GPT-5.4 Mini None",
    },
    {
      value: "gpt-5.4-mini-low",
      label: "gpt-5.4-mini-low",
      description: "GPT-5.4 Mini Low",
    },
    {
      value: "gpt-5.4-mini-medium",
      label: "gpt-5.4-mini-medium",
      description: "GPT-5.4 Mini",
    },
    {
      value: "gpt-5.4-mini-high",
      label: "gpt-5.4-mini-high",
      description: "GPT-5.4 Mini High",
    },
    {
      value: "gpt-5.4-mini-xhigh",
      label: "gpt-5.4-mini-xhigh",
      description: "GPT-5.4 Mini Extra High",
    },
    {
      value: "gpt-5.4-nano-none",
      label: "gpt-5.4-nano-none",
      description: "GPT-5.4 Nano None",
    },
    {
      value: "gpt-5.4-nano-low",
      label: "gpt-5.4-nano-low",
      description: "GPT-5.4 Nano Low",
    },
    {
      value: "gpt-5.4-nano-medium",
      label: "gpt-5.4-nano-medium",
      description: "GPT-5.4 Nano",
    },
    {
      value: "gpt-5.4-nano-high",
      label: "gpt-5.4-nano-high",
      description: "GPT-5.4 Nano High",
    },
    {
      value: "gpt-5.4-nano-xhigh",
      label: "gpt-5.4-nano-xhigh",
      description: "GPT-5.4 Nano Extra High",
    },
    {
      value: "grok-4.3",
      label: "grok-4.3",
      description: "Grok 4.3 1M",
    },
    {
      value: "claude-4.5-sonnet",
      label: "claude-4.5-sonnet",
      description: "Sonnet 4.5",
    },
    {
      value: "claude-4.5-sonnet-thinking",
      label: "claude-4.5-sonnet-thinking",
      description: "Sonnet 4.5 Thinking",
    },
    {
      value: "gpt-5.1-low",
      label: "gpt-5.1-low",
      description: "GPT-5.1 Low",
    },
    {
      value: "gpt-5.1",
      label: "gpt-5.1",
      description: "GPT-5.1",
    },
    {
      value: "gpt-5.1-high",
      label: "gpt-5.1-high",
      description: "GPT-5.1 High",
    },
    {
      value: "gemini-3-flash",
      label: "gemini-3-flash",
      description: "Gemini 3 Flash",
    },
    {
      value: "gemini-3.5-flash",
      label: "gemini-3.5-flash",
      description: "Gemini 3.5 Flash",
    },
    {
      value: "gpt-5.1-codex-mini-low",
      label: "gpt-5.1-codex-mini-low",
      description: "Codex 5.1 Mini Low",
    },
    {
      value: "gpt-5.1-codex-mini",
      label: "gpt-5.1-codex-mini",
      description: "Codex 5.1 Mini",
    },
    {
      value: "gpt-5.1-codex-mini-high",
      label: "gpt-5.1-codex-mini-high",
      description: "Codex 5.1 Mini High",
    },
    {
      value: "claude-4-sonnet",
      label: "claude-4-sonnet",
      description: "Sonnet 4",
    },
    {
      value: "claude-4-sonnet-thinking",
      label: "claude-4-sonnet-thinking",
      description: "Sonnet 4 Thinking",
    },
    {
      value: "gpt-5-mini",
      label: "gpt-5-mini",
      description: "GPT-5 Mini",
    },
    {
      value: "kimi-k2.5",
      label: "kimi-k2.5",
      description: "Kimi K2.5",
    },
  ],

  DEFAULT: "composer-2.5-fast",
};

/**
 * Codex (OpenAI) Models
 */
export const CODEX_MODELS = {
  OPTIONS: [
    { value: "gpt-5.5", label: "gpt-5.5" },
    { value: "gpt-5.4", label: "gpt-5.4" },
    { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    { value: "gpt-5.3-codex", label: "gpt-5.3-codex" },
    { value: "gpt-5.2", label: "gpt-5.2" },
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

/**
 * OpenCode Models
 *
 * OpenCode model ids include the upstream provider prefix.
 */
export const OPENCODE_MODELS = {
  OPTIONS: [
    {
      value: "opencode/big-pickle",
      label: "Big Pickle",
      description: "opencode - opencode/big-pickle",
    },
    {
      value: "opencode/deepseek-v4-flash-free",
      label: "Deepseek V4 Flash Free",
      description: "opencode - opencode/deepseek-v4-flash-free",
    },
    {
      value: "opencode/nemotron-3-super-free",
      label: "Nemotron 3 Super Free",
      description: "opencode - opencode/nemotron-3-super-free",
    },
    {
      value: "anthropic/claude-3-5-haiku-20241022",
      label: "Claude 3.5 Haiku (2024-10-22)",
      description: "anthropic - anthropic/claude-3-5-haiku-20241022",
    },
    {
      value: "anthropic/claude-3-5-haiku-latest",
      label: "Claude 3.5 Haiku Latest",
      description: "anthropic - anthropic/claude-3-5-haiku-latest",
    },
    {
      value: "anthropic/claude-3-5-sonnet-20240620",
      label: "Claude 3.5 Sonnet (2024-06-20)",
      description: "anthropic - anthropic/claude-3-5-sonnet-20240620",
    },
    {
      value: "anthropic/claude-3-5-sonnet-20241022",
      label: "Claude 3.5 Sonnet (2024-10-22)",
      description: "anthropic - anthropic/claude-3-5-sonnet-20241022",
    },
    {
      value: "anthropic/claude-3-7-sonnet-20250219",
      label: "Claude 3.7 Sonnet (2025-02-19)",
      description: "anthropic - anthropic/claude-3-7-sonnet-20250219",
    },
    {
      value: "anthropic/claude-3-haiku-20240307",
      label: "Claude 3 Haiku (2024-03-07)",
      description: "anthropic - anthropic/claude-3-haiku-20240307",
    },
    {
      value: "anthropic/claude-3-opus-20240229",
      label: "Claude 3 Opus (2024-02-29)",
      description: "anthropic - anthropic/claude-3-opus-20240229",
    },
    {
      value: "anthropic/claude-3-sonnet-20240229",
      label: "Claude 3 Sonnet (2024-02-29)",
      description: "anthropic - anthropic/claude-3-sonnet-20240229",
    },
    {
      value: "anthropic/claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      description: "anthropic - anthropic/claude-haiku-4-5",
    },
    {
      value: "anthropic/claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5 (2025-10-01)",
      description: "anthropic - anthropic/claude-haiku-4-5-20251001",
    },
    {
      value: "anthropic/claude-opus-4-0",
      label: "Claude Opus 4.0",
      description: "anthropic - anthropic/claude-opus-4-0",
    },
    {
      value: "anthropic/claude-opus-4-1",
      label: "Claude Opus 4.1",
      description: "anthropic - anthropic/claude-opus-4-1",
    },
    {
      value: "anthropic/claude-opus-4-1-20250805",
      label: "Claude Opus 4.1 (2025-08-05)",
      description: "anthropic - anthropic/claude-opus-4-1-20250805",
    },
    {
      value: "anthropic/claude-opus-4-20250514",
      label: "Claude Opus 4 (2025-05-14)",
      description: "anthropic - anthropic/claude-opus-4-20250514",
    },
    {
      value: "anthropic/claude-opus-4-5",
      label: "Claude Opus 4.5",
      description: "anthropic - anthropic/claude-opus-4-5",
    },
    {
      value: "anthropic/claude-opus-4-5-20251101",
      label: "Claude Opus 4.5 (2025-11-01)",
      description: "anthropic - anthropic/claude-opus-4-5-20251101",
    },
    {
      value: "anthropic/claude-opus-4-6",
      label: "Claude Opus 4.6",
      description: "anthropic - anthropic/claude-opus-4-6",
    },
    {
      value: "anthropic/claude-opus-4-6-fast",
      label: "Claude Opus 4.6 Fast",
      description: "anthropic - anthropic/claude-opus-4-6-fast",
    },
    {
      value: "anthropic/claude-opus-4-7",
      label: "Claude Opus 4.7",
      description: "anthropic - anthropic/claude-opus-4-7",
    },
    {
      value: "anthropic/claude-opus-4-7-fast",
      label: "Claude Opus 4.7 Fast",
      description: "anthropic - anthropic/claude-opus-4-7-fast",
    },
    {
      value: "anthropic/claude-sonnet-4-0",
      label: "Claude Sonnet 4.0",
      description: "anthropic - anthropic/claude-sonnet-4-0",
    },
    {
      value: "anthropic/claude-sonnet-4-20250514",
      label: "Claude Sonnet 4 (2025-05-14)",
      description: "anthropic - anthropic/claude-sonnet-4-20250514",
    },
    {
      value: "anthropic/claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      description: "anthropic - anthropic/claude-sonnet-4-5",
    },
    {
      value: "anthropic/claude-sonnet-4-5-20250929",
      label: "Claude Sonnet 4.5 (2025-09-29)",
      description: "anthropic - anthropic/claude-sonnet-4-5-20250929",
    },
    {
      value: "anthropic/claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      description: "anthropic - anthropic/claude-sonnet-4-6",
    },
    {
      value: "openai/gpt-5.2",
      label: "GPT-5.2",
      description: "openai - openai/gpt-5.2",
    },
    {
      value: "openai/gpt-5.3-codex",
      label: "GPT-5.3 Codex",
      description: "openai - openai/gpt-5.3-codex",
    },
    {
      value: "openai/gpt-5.3-codex-spark",
      label: "GPT-5.3 Codex Spark",
      description: "openai - openai/gpt-5.3-codex-spark",
    },
    {
      value: "openai/gpt-5.4",
      label: "GPT-5.4",
      description: "openai - openai/gpt-5.4",
    },
    {
      value: "openai/gpt-5.4-fast",
      label: "GPT-5.4 Fast",
      description: "openai - openai/gpt-5.4-fast",
    },
    {
      value: "openai/gpt-5.4-mini",
      label: "GPT-5.4 Mini",
      description: "openai - openai/gpt-5.4-mini",
    },
    {
      value: "openai/gpt-5.4-mini-fast",
      label: "GPT-5.4 Mini Fast",
      description: "openai - openai/gpt-5.4-mini-fast",
    },
    {
      value: "openai/gpt-5.5",
      label: "GPT-5.5",
      description: "openai - openai/gpt-5.5",
    },
    {
      value: "openai/gpt-5.5-fast",
      label: "GPT-5.5 Fast",
      description: "openai - openai/gpt-5.5-fast",
    },
    {
      value: "openai/gpt-5.5-pro",
      label: "GPT-5.5 Pro",
      description: "openai - openai/gpt-5.5-pro",
    },
  ],

  DEFAULT: "anthropic/claude-sonnet-4-5",
};

/**
 * Ordered provider registry. Display order in documentation.
 */
export const PROVIDERS = [
  { id: "claude", name: "Anthropic", models: CLAUDE_MODELS },
  { id: "codex", name: "OpenAI", models: CODEX_MODELS },
  { id: "gemini", name: "Google", models: GEMINI_MODELS },
  { id: "cursor", name: "Cursor", models: CURSOR_MODELS },
  { id: "opencode", name: "OpenCode", models: OPENCODE_MODELS },
];
