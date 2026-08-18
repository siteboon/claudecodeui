/**
 * Antigravity Auth Provider
 *
 * Implements IProviderAuth for the Antigravity CLI (agy).
 * Detects whether the CLI is installed and configured on the system.
 *
 * @module antigravity-auth.provider
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { getEngineVersion, tryResolveEnginePath } from './antigravity-engine-path.js';

/**
 * Checks whether Antigravity configuration or credentials exist locally.
 */
function checkAntigravityAuthenticated(): boolean {
  const cliDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  const desktopDir = path.join(os.homedir(), '.gemini', 'antigravity');

  // Settings file or installation id in either directory indicates initialized state
  const settingsFile = path.join(cliDir, 'settings.json');
  const installationIdFile = path.join(desktopDir, 'installation_id');
  const cliInstallationIdFile = path.join(cliDir, 'installation_id');

  return fs.existsSync(settingsFile) || fs.existsSync(installationIdFile) || fs.existsSync(cliInstallationIdFile);
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
