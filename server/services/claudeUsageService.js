import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map(); // userId -> { data, fetchedAt }

// Path to the claude-usage-tray package directory (configurable via env).
const TRAY_DIR = process.env.CLAUDE_USAGE_TRAY_DIR
  || path.resolve(__dirname, '..', '..', '..', 'claude-usage-tray');

function runUsageTool(sessionKey) {
  return new Promise((resolve) => {
    // xvfb-run provides a virtual display so Chromium launches in non-headless
    // mode, bypassing Cloudflare's headless-browser detection.
    const proc = spawn(
      'xvfb-run', ['-a', 'python3', '-m', 'claude_usage_tray', '--json'],
      {
        cwd: TRAY_DIR,
        env: { ...process.env, CLAUDE_SESSION_KEY: sessionKey },
      }
    );

    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => {
      proc.kill();
      resolve({ error: 'Usage tool timed out after 60 seconds' });
    }, 60000);

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({ error: `Failed to start usage tool: ${err.message}` });
    });

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        resolve({ error: `Usage tool exited with code ${code}: ${stderr.slice(0, 300)}` });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ error: 'Usage tool returned invalid JSON' });
      }
    });
  });
}

export async function getClaudeUsage(userId, sessionKey, forceRefresh = false) {
  const cached = cache.get(userId);
  if (!forceRefresh && cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return { ...cached.data, cached: true, fetchedAt: new Date(cached.fetchedAt).toISOString() };
  }

  const data = await runUsageTool(sessionKey);
  const fetchedAt = Date.now();
  cache.set(userId, { data, fetchedAt });
  return { ...data, cached: false, fetchedAt: new Date(fetchedAt).toISOString() };
}
