/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';

/**
 * Optional path to a custom Claude settings JSON file.
 * Mirrors the structure of ~/.claude/settings.json (allowedTools, disallowedTools, permissionMode, etc.).
 * Set via CLAUDE_SETTINGS_PATH env var or the --settings CLI flag.
 */
export const CLAUDE_SETTINGS_PATH = process.env.CLAUDE_SETTINGS_PATH || null;