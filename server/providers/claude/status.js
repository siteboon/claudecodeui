/**
 * Claude Provider Status
 *
 * Checks whether Claude Code CLI is installed and whether the user
 * has valid authentication credentials.
 *
 * @module providers/claude/status
 */

import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Check if Claude Code CLI is installed and available.
 * Uses CLAUDE_CLI_PATH env var if set, otherwise looks for 'claude' in PATH.
 * @returns {boolean}
 */
export function checkInstalled() {
  const cliPath = process.env.CLAUDE_CLI_PATH || 'claude';
  try {
    execFileSync(cliPath, ['--version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Full status check: installation + authentication.
 * @returns {Promise<import('../types.js').ProviderStatus>}
 */
export async function checkStatus() {
  const installed = checkInstalled();

  if (!installed) {
    return {
      installed,
      authenticated: false,
      email: null,
      method: null,
      error: 'Claude Code CLI is not installed'
    };
  }

  const credentialsResult = await checkCredentials();

  if (credentialsResult.authenticated) {
    return {
      installed,
      authenticated: true,
      email: credentialsResult.email || 'Authenticated',
      method: credentialsResult.method || null,
      error: null
    };
  }

  return {
    installed,
    authenticated: false,
    email: credentialsResult.email || null,
    method: credentialsResult.method || null,
    error: credentialsResult.error || 'Not authenticated'
  };
}

// ─── Internal helpers ───────────────────────────────────────────────────────

async function loadSettingsEnv() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(content);

    if (settings?.env && typeof settings.env === 'object') {
      return settings.env;
    }
  } catch {
    // Ignore missing or malformed settings.
  }

  return {};
}

/**
 * Checks Claude authentication credentials.
 *
 * Priority 1: ANTHROPIC_API_KEY environment variable
 * Priority 1b: ~/.claude/settings.json env values
 * Priority 2: ~/.claude/.credentials.json OAuth tokens
 */
async function checkCredentials() {
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) {
    return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
  }

  const settingsEnv = await loadSettingsEnv();

  if (typeof settingsEnv.ANTHROPIC_API_KEY === 'string' && settingsEnv.ANTHROPIC_API_KEY.trim()) {
    return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
  }

  if (typeof settingsEnv.ANTHROPIC_AUTH_TOKEN === 'string' && settingsEnv.ANTHROPIC_AUTH_TOKEN.trim()) {
    return { authenticated: true, email: 'Configured via settings.json', method: 'api_key' };
  }

  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);

    const oauth = creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      const isExpired = oauth.expiresAt && Date.now() >= oauth.expiresAt;
      if (!isExpired) {
        return {
          authenticated: true,
          email: creds.email || creds.user || null,
          method: 'credentials_file'
        };
      }

      return {
        authenticated: false,
        email: creds.email || creds.user || null,
        method: 'credentials_file',
        error: 'OAuth token has expired. Please re-authenticate with claude login'
      };
    }

    return { authenticated: false, email: null, method: null };
  } catch {
    return { authenticated: false, email: null, method: null };
  }
}
