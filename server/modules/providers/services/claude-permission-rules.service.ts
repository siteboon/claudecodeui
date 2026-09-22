import path from 'node:path';

import { readJsonConfig, readObjectRecord, writeJsonConfig } from '@/shared/utils.js';

/**
 * Where the Claude CLI itself records an "always allow" answer: the project's
 * `.claude/settings.local.json`. Its own permission prompts emit
 * `{ type: 'addRules', behavior: 'allow', destination: 'localSettings' }`, and
 * `localSettings` resolves to this file. Writing the same file keeps the UI and
 * the CLI on one rule set, and the runtime already lists `local` in
 * `settingSources`, so the next `query()` reads it back.
 */
const LOCAL_SETTINGS_RELATIVE_PATH = path.join('.claude', 'settings.local.json');

/**
 * Upper bound on a remembered rule, which arrives from the client. Real rules
 * ("Write", "Bash(git commit:*)") are far shorter; the cap only stops a hostile
 * or buggy client from appending an unbounded blob to a project file.
 */
const MAX_RULE_LENGTH = 512;

/** A rule must be a single-line, non-empty, reasonably short string to be persisted. */
function normalizeRuleEntry(ruleEntry: unknown): string | null {
  if (typeof ruleEntry !== 'string') {
    return null;
  }

  const trimmed = ruleEntry.trim();
  if (!trimmed || trimmed.length > MAX_RULE_LENGTH || /[\r\n]/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Persists an "always allow" answer into the project's
 * `.claude/settings.local.json` under `permissions.allow`.
 *
 * Used by claude-runtime.provider's `canUseTool` so a remembered rule outlives
 * the turn it was granted in: the in-memory `allowedTools` push only covers the
 * running query, while this file is re-read by the CLI on every later turn,
 * session and server restart.
 *
 * Resolves to `true` only when the file gained the rule. Every failure mode —
 * a missing/relative project directory, an unreadable or malformed settings
 * file, an unwritable path — resolves to `false` after logging, because the
 * caller answers a live permission prompt and must never fail a turn over
 * bookkeeping. A settings file that exists but does not parse is left exactly
 * as it is rather than being replaced with a generated one.
 */
export async function rememberClaudeToolPermission(
  projectDirectory: unknown,
  ruleEntry: unknown,
): Promise<boolean> {
  const rule = normalizeRuleEntry(ruleEntry);
  if (!rule) {
    return false;
  }

  if (typeof projectDirectory !== 'string' || !path.isAbsolute(projectDirectory)) {
    console.warn('[Claude SDK] Cannot persist permission rule without an absolute project directory');
    return false;
  }

  const settingsPath = path.join(projectDirectory, LOCAL_SETTINGS_RELATIVE_PATH);

  try {
    // Read-modify-write so unrelated keys (model, env, hooks, other permission
    // lists) survive, matching how the CLI edits the same file.
    const settings = await readJsonConfig(settingsPath);
    const permissions = readObjectRecord(settings.permissions) ?? {};
    // Kept verbatim rather than normalized, so an entry this app does not
    // understand is never dropped from someone else's settings file.
    const allow = Array.isArray(permissions.allow) ? permissions.allow : [];

    if (allow.includes(rule)) {
      return false;
    }

    await writeJsonConfig(settingsPath, {
      ...settings,
      permissions: { ...permissions, allow: [...allow, rule] },
    });
    return true;
  } catch (error) {
    console.warn(`[Claude SDK] Failed to persist permission rule "${rule}" to ${settingsPath}:`, error);
    return false;
  }
}
