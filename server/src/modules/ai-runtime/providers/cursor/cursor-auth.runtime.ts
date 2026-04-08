import spawn from 'cross-spawn';

import type { IProviderAuthRuntime, ProviderAuthStatus } from '@/modules/ai-runtime/types/index.js';

const CURSOR_STATUS_TIMEOUT_MS = 5_000;

/**
 * Reads auth status from `cursor-agent status`.
 */
export class CursorAuthRuntime implements IProviderAuthRuntime {
  async getStatus(): Promise<ProviderAuthStatus> {
    return new Promise((resolve) => {
      let completed = false;
      let childProcess: ReturnType<typeof spawn> | null = null;
      const timeout = setTimeout(() => {
        if (completed) {
          return;
        }

        completed = true;
        if (childProcess) {
          childProcess.kill();
        }

        resolve({
          provider: 'cursor',
          authenticated: false,
          email: null,
          method: null,
          error: 'Command timeout',
        });
      }, CURSOR_STATUS_TIMEOUT_MS);

      try {
        childProcess = spawn('cursor-agent', ['status']);
      } catch {
        clearTimeout(timeout);
        completed = true;
        resolve({
          provider: 'cursor',
          authenticated: false,
          email: null,
          method: null,
          error: 'Cursor CLI not found or not installed',
        });
        return;
      }

      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      childProcess.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      childProcess.on('close', (code) => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timeout);

        if (code === 0) {
          const emailMatch = stdout.match(/Logged in as ([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
          if (emailMatch) {
            resolve({
              provider: 'cursor',
              authenticated: true,
              email: emailMatch[1],
              method: null,
            });
            return;
          }

          if (stdout.includes('Logged in')) {
            resolve({
              provider: 'cursor',
              authenticated: true,
              email: 'Logged in',
              method: null,
            });
            return;
          }

          resolve({
            provider: 'cursor',
            authenticated: false,
            email: null,
            method: null,
            error: 'Not logged in',
          });
          return;
        }

        resolve({
          provider: 'cursor',
          authenticated: false,
          email: null,
          method: null,
          error: stderr.trim() || 'Not logged in',
        });
      });

      childProcess.on('error', () => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timeout);
        resolve({
          provider: 'cursor',
          authenticated: false,
          email: null,
          method: null,
          error: 'Cursor CLI not found or not installed',
        });
      });
    });
  }
}
