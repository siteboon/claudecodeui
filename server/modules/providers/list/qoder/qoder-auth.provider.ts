import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { getQoderHome } from '@/shared/utils.js';

/**
 * Qoder persists its auth state as an encrypted blob under `~/.qoder/.auth/user`
 * (600 perms). Presence of the file means the CLI has completed at least one
 * `qodercli login` and can issue authenticated requests. The blob itself is
 * opaque to the server, so only existence is checked.
 */
const QODER_AUTH_FILE = '.auth/user';

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

export class QoderProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Qoder CLI is available to the server process.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('qodercli', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns Qoder CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const authenticated = await this.checkCredentials();

    return {
      installed,
      provider: 'qoder',
      authenticated,
      email: authenticated ? 'qoder credentials' : null,
      method: authenticated ? 'credentials_file' : null,
      error: authenticated ? undefined : 'Not authenticated',
    };
  }

  /**
   * Reads Qoder's auth blob and reports whether a login exists.
   */
  private async checkCredentials(): Promise<boolean> {
    try {
      const authPath = path.join(getQoderHome(), QODER_AUTH_FILE);
      if (!(await fileExists(authPath))) {
        return false;
      }

      const content = await readFile(authPath, 'utf8');
      return content.trim().length > 0;
    } catch {
      return false;
    }
  }
}
