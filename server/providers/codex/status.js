/**
 * Codex Provider Status
 *
 * Checks whether the user has valid Codex authentication credentials.
 * Codex uses an SDK that makes direct API calls (no external binary),
 * so installation check always returns true if the server is running.
 *
 * @module providers/codex/status
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Check if Codex is installed.
 * Codex SDK is bundled with this application — no external binary needed.
 * @returns {boolean}
 */
export function checkInstalled() {
  return true;
}

/**
 * Full status check: installation + authentication.
 * @returns {Promise<import('../types.js').ProviderStatus>}
 */
export async function checkStatus() {
  const installed = checkInstalled();
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
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);

    const tokens = auth.tokens || {};

    if (tokens.id_token || tokens.access_token) {
      let email = 'Authenticated';
      if (tokens.id_token) {
        try {
          const parts = tokens.id_token.split('.');
          if (parts.length >= 2) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            email = payload.email || payload.user || 'Authenticated';
          }
        } catch {
          email = 'Authenticated';
        }
      }

      return { authenticated: true, email };
    }

    if (auth.OPENAI_API_KEY) {
      return { authenticated: true, email: 'API Key Auth' };
    }

    return { authenticated: false, email: null, error: 'No valid tokens found' };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { authenticated: false, email: null, error: 'Codex not configured' };
    }
    return { authenticated: false, email: null, error: error.message };
  }
}
