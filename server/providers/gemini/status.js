/**
 * Gemini Provider Status
 *
 * Checks whether Gemini CLI is installed and whether the user
 * has valid authentication credentials.
 *
 * @module providers/gemini/status
 */

import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Check if Gemini CLI is installed.
 * Uses GEMINI_PATH env var if set, otherwise looks for 'gemini' in PATH.
 * @returns {boolean}
 */
export function checkInstalled() {
  const cliPath = process.env.GEMINI_PATH || 'gemini';
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
      error: 'Gemini CLI is not installed'
    };
  }

  const result = await checkCredentials();

  return {
    installed,
    authenticated: result.authenticated,
    email: result.email || null,
    error: result.error || null
  };
}

// ─── Internal helpers ───────────────────────────────────────────────────────

async function checkCredentials() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return { authenticated: true, email: 'API Key Auth' };
  }

  try {
    const credsPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
    const content = await fs.readFile(credsPath, 'utf8');
    const creds = JSON.parse(content);

    if (creds.access_token) {
      let email = 'OAuth Session';

      try {
        const tokenRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${creds.access_token}`);
        if (tokenRes.ok) {
          const tokenInfo = await tokenRes.json();
          if (tokenInfo.email) {
            email = tokenInfo.email;
          }
        } else if (!creds.refresh_token) {
          return {
            authenticated: false,
            email: null,
            error: 'Access token invalid and no refresh token found'
          };
        } else {
          // Token might be expired but we have a refresh token, so CLI will refresh it
          email = await getActiveAccountEmail() || email;
        }
      } catch {
        // Network error, fallback to checking local accounts file
        email = await getActiveAccountEmail() || email;
      }

      return { authenticated: true, email };
    }

    return { authenticated: false, email: null, error: 'No valid tokens found in oauth_creds' };
  } catch {
    return { authenticated: false, email: null, error: 'Gemini CLI not configured' };
  }
}

async function getActiveAccountEmail() {
  try {
    const accPath = path.join(os.homedir(), '.gemini', 'google_accounts.json');
    const accContent = await fs.readFile(accPath, 'utf8');
    const accounts = JSON.parse(accContent);
    return accounts.active || null;
  } catch {
    return null;
  }
}
