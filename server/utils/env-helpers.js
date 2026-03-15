import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Returns true if the value is a string considered "truthy" for env flags
 * (e.g. CLAUDE_CODE_USE_BEDROCK). Accepts '1', 'true', 'yes', 'on' (case-insensitive).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isTruthyValue(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Loads env key/value pairs from ~/.claude/settings.json (settings.env).
 * Used for auth and model config that may be set in Claude Code settings.
 * @returns {Promise<Record<string, unknown>>} Env object or {} on missing/malformed file.
 */
export async function loadClaudeSettingsEnv() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(content);

    if (settings?.env && typeof settings.env === 'object') {
      return settings.env;
    }
  } catch {
    // Ignore missing or malformed settings and fall back to empty.
  }

  return {};
}
