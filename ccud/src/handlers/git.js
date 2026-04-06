/**
 * @module ccud/handlers/git
 * Git command execution handler for git/* RPC methods.
 * Uses execFile (safe, no shell) to run git commands on the remote host.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Handle all git/* JSON-RPC methods.
 *
 * Supported methods:
 * - git/exec: Execute a git command with given args in a given cwd
 *
 * @param {string} method - The RPC method name (e.g., 'git/exec')
 * @param {object} params - Method parameters
 * @param {string[]} params.args - Git command arguments
 * @param {string} params.cwd - Working directory for the git command
 * @returns {Promise<object>} Result object or error object with { error: { code, message } }
 */
export async function handleGit(method, params) {
  try {
    switch (method) {
      case 'git/exec': {
        if (!Array.isArray(params?.args) || typeof params?.cwd !== 'string' || !params.cwd) {
          return { error: { code: -32602, message: 'Missing args or cwd' } };
        }

        try {
          const { stdout, stderr } = await execFileAsync('git', params.args, {
            cwd: params.cwd,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000,
          });
          return { stdout, stderr, exitCode: 0 };
        } catch (err) {
          return {
            stdout: err.stdout || '',
            stderr: err.stderr || '',
            exitCode: typeof err.code === 'number' ? err.code : (err.status || 1),
            message: err.message,
          };
        }
      }

      default:
        return { error: { code: -32601, message: 'Method not found: ' + method } };
    }
  } catch (err) {
    return { error: { code: -32000, message: err.message } };
  }
}
