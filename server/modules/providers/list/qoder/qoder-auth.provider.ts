import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { spawn } from 'node:child_process';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { fileExists, getQoderHome } from '@/shared/utils.js';

/**
 * Qoder persists its auth state as an encrypted blob under `~/.qoder/.auth/user`
 * (600 perms). Presence of the file means the CLI has completed at least one
 * `qodercli login` and can issue authenticated requests. The blob itself is
 * opaque to the server, so only existence is checked.
 */
const QODER_AUTH_FILE = '.auth/user';

export class QoderProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Qoder CLI is available to the server process.
   * Uses a non-blocking spawn with a 5 s timeout to avoid stalling the event loop.
   */
  private checkInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('qodercli', ['--version'], { stdio: 'ignore' });
      const timer = setTimeout(() => { proc.kill(); resolve(false); }, 5000);
      proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
      proc.on('error', () => { clearTimeout(timer); resolve(false); });
    });
  }

  /**
   * Returns Qoder CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkInstalled();
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
