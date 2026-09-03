import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';

import { getZCodeStorageDir } from './zcode-data-root.js';

import { getEngineVersion, tryResolveEnginePath } from './zcode-engine-path.js';

/**
 * Reads ZCode OAuth credentials from the encrypted credential store.
 *
 * Phase 0.2 findings: credentials live at `<storage>/v2/credentials.json` in
 * the encrypted `enc:v1:<payload>.<salt>.<iv>` format, keyed by entries such
 * as `oauth:bigmodel:access_token` and `zcodejwttoken`. Because the payload
 * is encrypted, detection is a presence check only and the user email cannot
 * be extracted (returned as null per integration plan §3.2.4).
 */
const readZCodeCredentials = async (): Promise<{
  authenticated: boolean;
  method: string | null;
  error?: string;
}> => {
  const credPath = path.join(getZCodeStorageDir(), 'v2', 'credentials.json');

  try {
    const content = await readFile(credPath, 'utf8');
    const credentials = readObjectRecord(JSON.parse(content));

    if (!credentials) {
      return {
        authenticated: false,
        method: null,
        error: 'ZCode credentials file is unreadable. Run the login command again.',
      };
    }

    const hasAccessToken = typeof credentials['oauth:bigmodel:access_token'] === 'string'
      || typeof credentials['zcodejwttoken'] === 'string';

    if (!hasAccessToken) {
      return {
        authenticated: false,
        method: null,
        error: 'No ZCode login credentials found. Run the login command.',
      };
    }

    return {
      authenticated: true,
      method: 'Z.AI OAuth',
    };
  } catch (error) {
    let errorMessage = 'Unable to read ZCode credentials. Run the login command.';

    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      errorMessage = 'ZCode credentials not found. Run the login command.';
    } else if (error instanceof SyntaxError) {
      errorMessage = 'ZCode credentials file is corrupted. Run the login command again.';
    }

    return {
      authenticated: false,
      method: null,
      error: errorMessage,
    };
  }
};

/**
 * ZCode authentication provider implementing installation and credential
 * detection per integration plan §3.2.4.
 */
export class ZCodeProviderAuth implements IProviderAuth {
  /**
   * Returns ZCode installation and authentication status.
   *
   * `installed` mirrors `zcode-engine-path` resolution success, annotated
   * with the detected CLI version; `loginCommand` carries the
   * `node <engine-path> login` guide the frontend login modal should run.
   * Never throws for uninstalled/unauthenticated states per contract.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const enginePath = tryResolveEnginePath();

    if (!enginePath) {
      return {
        installed: false,
        provider: 'zcode',
        authenticated: false,
        email: null,
        method: null,
        error: 'ZCode is not installed. Install the ZCode desktop app from https://z.ai/download first.',
      };
    }

    const credentials = await readZCodeCredentials();

    return {
      installed: true,
      provider: 'zcode',
      authenticated: credentials.authenticated,
      email: null,
      method: credentials.authenticated
        ? credentials.method
        : getEngineVersion(),
      error: credentials.authenticated ? undefined : credentials.error,
      loginCommand: `node ${enginePath} login`,
    };
  }
}
