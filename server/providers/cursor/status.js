/**
 * Cursor Provider Status
 *
 * Checks whether cursor-agent CLI is installed and whether the user
 * is logged in.
 *
 * @module providers/cursor/status
 */

import { execFileSync, spawn } from 'child_process';

/**
 * Check if cursor-agent CLI is installed.
 * @returns {boolean}
 */
export function checkInstalled() {
  try {
    execFileSync('cursor-agent', ['--version'], { stdio: 'ignore', timeout: 5000 });
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
      error: 'Cursor CLI is not installed'
    };
  }

  const result = await checkCursorLogin();

  return {
    installed,
    authenticated: result.authenticated,
    email: result.email || null,
    error: result.error || null
  };
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function checkCursorLogin() {
  return new Promise((resolve) => {
    let processCompleted = false;

    const timeout = setTimeout(() => {
      if (!processCompleted) {
        processCompleted = true;
        if (childProcess) {
          childProcess.kill();
        }
        resolve({
          authenticated: false,
          email: null,
          error: 'Command timeout'
        });
      }
    }, 5000);

    let childProcess;
    try {
      childProcess = spawn('cursor-agent', ['status']);
    } catch {
      clearTimeout(timeout);
      processCompleted = true;
      resolve({
        authenticated: false,
        email: null,
        error: 'Cursor CLI not found or not installed'
      });
      return;
    }

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      if (code === 0) {
        const emailMatch = stdout.match(/Logged in as ([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

        if (emailMatch) {
          resolve({ authenticated: true, email: emailMatch[1] });
        } else if (stdout.includes('Logged in')) {
          resolve({ authenticated: true, email: 'Logged in' });
        } else {
          resolve({ authenticated: false, email: null, error: 'Not logged in' });
        }
      } else {
        resolve({ authenticated: false, email: null, error: stderr || 'Not logged in' });
      }
    });

    childProcess.on('error', () => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      resolve({
        authenticated: false,
        email: null,
        error: 'Cursor CLI not found or not installed'
      });
    });
  });
}
