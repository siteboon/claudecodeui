import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const router = express.Router();

router.get('/claude/status', async (req, res) => {
  try {
    const credentialsResult = await checkClaudeCredentials();

    if (credentialsResult.authenticated) {
      return res.json({
        authenticated: true,
        email: credentialsResult.email || 'Authenticated',
        method: credentialsResult.method  // 'api_key' or 'credentials_file'
      });
    }

    return res.json({
      authenticated: false,
      email: null,
      method: null,
      error: credentialsResult.error || 'Not authenticated'
    });

  } catch (error) {
    console.error('Error checking Claude auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      method: null,
      error: error.message
    });
  }
});

router.get('/cursor/status', async (req, res) => {
  try {
    const result = await checkCursorStatus();

    res.json({
      authenticated: result.authenticated,
      email: result.email,
      error: result.error
    });

  } catch (error) {
    console.error('Error checking Cursor auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

router.get('/codex/status', async (req, res) => {
  try {
    const result = await checkCodexCredentials();

    res.json({
      authenticated: result.authenticated,
      email: result.email,
      error: result.error
    });

  } catch (error) {
    console.error('Error checking Codex auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message
    });
  }
});

/**
 * Checks Claude authentication credentials using two methods with priority order:
 *
 * Priority 1: ANTHROPIC_API_KEY environment variable
 * Priority 2: ~/.claude/.credentials.json OAuth tokens
 *
 * The Claude Agent SDK prioritizes environment variables over authenticated subscriptions.
 * This matching behavior ensures consistency with how the SDK authenticates.
 *
 * References:
 * - https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code
 *   "Claude Code prioritizes environment variable API keys over authenticated subscriptions"
 * - https://platform.claude.com/docs/en/agent-sdk/overview
 *   SDK authentication documentation
 *
 * @returns {Promise<Object>} Authentication status with { authenticated, email, method }
 *   - authenticated: boolean indicating if valid credentials exist
 *   - email: user email or auth method identifier
 *   - method: 'api_key' for env var, 'credentials_file' for OAuth tokens
 */
async function checkClaudeCredentials() {
  // Priority 1: Check for ANTHROPIC_API_KEY environment variable
  // The SDK checks this first and uses it if present, even if OAuth tokens exist.
  // When set, API calls are charged via pay-as-you-go rates instead of subscription.
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) {
    return {
      authenticated: true,
      email: 'API Key Auth',
      method: 'api_key'
    };
  }

  // Priority 2: Check ~/.claude/.credentials.json for OAuth tokens
  // This is the standard authentication method used by Claude CLI after running
  // 'claude /login' or 'claude setup-token' commands.
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);

    const oauth = creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      const isExpired = oauth.expiresAt && Date.now() >= oauth.expiresAt;

      if (!isExpired) {
        return {
          authenticated: true,
          email: creds.email || creds.user || null,
          method: 'credentials_file'
        };
      }
    }

    return {
      authenticated: false,
      email: null,
      method: null
    };
  } catch (error) {
    return {
      authenticated: false,
      email: null,
      method: null
    };
  }
}

function checkCursorStatus() {
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
    } catch (err) {
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
          resolve({
            authenticated: true,
            email: emailMatch[1],
            output: stdout
          });
        } else if (stdout.includes('Logged in')) {
          resolve({
            authenticated: true,
            email: 'Logged in',
            output: stdout
          });
        } else {
          resolve({
            authenticated: false,
            email: null,
            error: 'Not logged in'
          });
        }
      } else {
        resolve({
          authenticated: false,
          email: null,
          error: stderr || 'Not logged in'
        });
      }
    });

    childProcess.on('error', (err) => {
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

async function checkCodexCredentials() {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);

    // Tokens are nested under 'tokens' key
    const tokens = auth.tokens || {};

    // Check for valid tokens (id_token or access_token)
    if (tokens.id_token || tokens.access_token) {
      // Try to extract email from id_token JWT payload
      let email = 'Authenticated';
      if (tokens.id_token) {
        try {
          // JWT is base64url encoded: header.payload.signature
          const parts = tokens.id_token.split('.');
          if (parts.length >= 2) {
            // Decode the payload (second part)
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            email = payload.email || payload.user || 'Authenticated';
          }
        } catch {
          // If JWT decoding fails, use fallback
          email = 'Authenticated';
        }
      }

      return {
        authenticated: true,
        email
      };
    }

    // Also check for OPENAI_API_KEY as fallback auth method
    if (auth.OPENAI_API_KEY) {
      return {
        authenticated: true,
        email: 'API Key Auth'
      };
    }

    return {
      authenticated: false,
      email: null,
      error: 'No valid tokens found'
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        error: 'Codex not configured'
      };
    }
    return {
      authenticated: false,
      email: null,
      error: error.message
    };
  }
}

export default router;
