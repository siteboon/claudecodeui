import os from 'node:os';
import path from 'node:path';

/**
 * Resolves Claude Code's own config/data directory (the directory that
 * holds `projects/`, `settings.json`, `.claude.json`, `.credentials.json`,
 * `sessions/`, `commands/`, etc).
 *
 * Claude Code itself honors `CLAUDE_CONFIG_DIR` to relocate this directory
 * away from the default `~/.claude` — commonly used to run multiple Claude
 * accounts/profiles side by side. CloudCLI needs to resolve the same
 * directory so it reads/writes the profile the user actually has active,
 * instead of always falling back to `~/.claude`.
 */
export function getClaudeConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return path.join(os.homedir(), '.claude');
}
