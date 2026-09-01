/**
 * Antigravity Auth Provider
 *
 * Implements IProviderAuth for the Antigravity CLI (agy).
 * Detects whether the CLI is installed and configured on the system.
 *
 * @module antigravity-auth.provider
 */

import fs from 'node:fs';
import path from 'node:path';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { getEngineVersion, tryResolveEnginePath } from './antigravity-engine-path.js';
import { getAntigravityDataRoot } from './antigravity-sessions.provider.js';

/**
 * Checks whether the Antigravity CLI holds OAuth credentials.
 *
 * Only the token file written by a completed `agy` login counts as
 * authenticated: `installation_id` and `settings.json` are created on first
 * launch regardless of login state, so they must never mark the provider as
 * authenticated.
 */
function checkAntigravityAuthenticated(): boolean {
  const tokenFile = path.join(getAntigravityDataRoot(), 'antigravity-oauth-token');
  return fs.existsSync(tokenFile);
}

export class AntigravityProviderAuth implements IProviderAuth {
  /**
   * Returns Antigravity CLI installation and authentication status.
   * Never throws errors for uninstalled/unauthenticated states.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const enginePath = tryResolveEnginePath();

    if (!enginePath) {
      return {
        installed: false,
        provider: 'antigravity',
        authenticated: false,
        email: null,
        method: null,
        error: 'Antigravity CLI (agy) is not installed. Visit https://antigravity.google/docs to install it.',
        loginCommand: 'agy',
      };
    }

    const version = getEngineVersion();
    const authenticated = checkAntigravityAuthenticated();

    return {
      installed: true,
      provider: 'antigravity',
      authenticated,
      email: null,
      method: authenticated ? (version ? `Google Antigravity CLI ${version}` : 'Google OAuth') : null,
      error: authenticated ? undefined : 'Antigravity CLI is not logged in. Run `agy` in your terminal to log in.',
      loginCommand: 'agy',
    };
  }
}
