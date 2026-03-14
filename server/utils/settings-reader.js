/**
 * Settings Reader for Full REPL Mode
 *
 * Reads, caches, and writes ~/.claude/settings.json to achieve parity
 * with the native Claude Code CLI permissions and MCP server config.
 */

import { promises as fs } from 'fs';
import crypto from 'crypto';
import path from 'path';
import os from 'os';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
let cachedSettings = null;
let cachedMtime = 0;

/**
 * Returns true when Full REPL Mode is enabled via environment variable.
 * The frontend can also send a per-request override, but the env var
 * is the server-wide default.
 */
export function isFullReplMode(requestOverride) {
  if (typeof requestOverride === 'boolean') return requestOverride;
  return process.env.CLAUDE_FULL_REPL_MODE === 'true';
}

/**
 * Reads ~/.claude/settings.json with mtime-based caching.
 * Returns null when the file is missing or unreadable.
 */
export async function getSettings() {
  try {
    const stat = await fs.stat(SETTINGS_PATH).catch(() => null);
    if (!stat) return null;

    if (stat.mtimeMs !== cachedMtime) {
      const content = await fs.readFile(SETTINGS_PATH, 'utf8');
      cachedSettings = JSON.parse(content);
      cachedMtime = stat.mtimeMs;
    }

    return cachedSettings;
  } catch (error) {
    console.error('Failed to read settings.json:', error.message);
    return null;
  }
}

/**
 * Returns the permissions object from settings.json.
 */
export async function getPermissions() {
  const settings = await getSettings();
  return settings?.permissions || { allow: [], deny: [] };
}

/**
 * Returns MCP servers defined in ~/.claude/settings.json.
 */
export async function getMcpServersFromSettings() {
  const settings = await getSettings();
  return settings?.mcpServers || {};
}

/**
 * Persists a newly-approved tool entry to ~/.claude/settings.json
 * using an atomic read-modify-write pattern (write to temp, rename).
 */
export async function persistAllowedTool(entry) {
  try {
    // Ensure ~/.claude directory exists
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });

    let settings = {};
    try {
      const content = await fs.readFile(SETTINGS_PATH, 'utf8');
      settings = JSON.parse(content);
    } catch {
      // File missing or corrupt, start fresh
    }

    if (!settings.permissions) settings.permissions = { allow: [], deny: [] };
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

    if (settings.permissions.allow.includes(entry)) return;

    settings.permissions.allow.push(entry);

    // Atomic write: temp file with unique suffix + rename
    const suffix = process.pid + '.' + Date.now() + '.' + crypto.randomBytes(4).toString('hex');
    const tmpPath = SETTINGS_PATH + '.tmp.' + suffix;
    await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
    await fs.rename(tmpPath, SETTINGS_PATH);

    // Invalidate cache so the next read picks up the change
    cachedMtime = 0;
    cachedSettings = null;

    console.log(`[Full REPL] Persisted allowed tool: ${entry}`);
  } catch (error) {
    console.error('Failed to persist allowed tool:', error.message);
  }
}

export { SETTINGS_PATH };
