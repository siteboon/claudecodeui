// Load environment variables from .env before other imports execute.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// This bootstrap cannot import shared/utils.ts: that module reads environment
// defaults during evaluation, before this file has loaded `.env`.
function getBootstrapApplicationRoot(importMetaUrl: string) {
  const moduleDirectory = path.dirname(fileURLToPath(importMetaUrl));
  let serverRoot = moduleDirectory;
  while (path.basename(serverRoot) !== 'server') {
    const parent = path.dirname(serverRoot);
    if (parent === serverRoot) throw new Error('Could not resolve server root');
    serverRoot = parent;
  }
  const parent = path.dirname(serverRoot);
  return path.basename(parent) === 'dist-server' ? path.dirname(parent) : parent;
}

/**
 * Parses one `.env` line into a key/value pair, or `null` for blank lines,
 * comments and lines with no `=`. Exported for tests: the module body below runs
 * on import, so this is the only way to exercise the parsing rules directly.
 */
export function parseEnvironmentFileLine(line: string): { key: string; value: string } | null {
  const trimmedLine = line.trim();
  if (!trimmedLine || trimmedLine.startsWith('#')) return null;
  const separatorIndex = trimmedLine.indexOf('=');
  if (separatorIndex === -1) return null;
  // Trim the key and strip one matched pair of surrounding quotes. Both are
  // dotenv idioms, and without this `KEY = value` produced a key with a trailing
  // space (so the variable looked unset) while KEY="value" kept the quote
  // characters inside the value.
  const key = trimmedLine.slice(0, separatorIndex).trim();
  if (!key) return null;
  const value = trimmedLine.slice(separatorIndex + 1).trim();
  return { key, value: /^"[\s\S]*"$|^'[\s\S]*'$/.test(value) ? value.slice(1, -1) : value };
}

// Resolve the repo/app root via the nearest /server folder so this file keeps finding the
// same top-level .env file from both /server/load-env.ts and /dist-server/server/load-env.js.
const APP_ROOT = getBootstrapApplicationRoot(import.meta.url);

try {
  const envPath = path.join(APP_ROOT, '.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const parsed = parseEnvironmentFileLine(line);
    if (parsed && !process.env[parsed.key]) {
      process.env[parsed.key] = parsed.value;
    }
  });
} catch (e: any) {
  console.error('No .env file found or error reading it:', e.message);
}

// Keep the default database in a stable user-level location so rebuilding dist-server
// never changes where the backend stores auth.db when DATABASE_PATH is not set explicitly.
const DEFAULT_DATABASE_PATH = path.join(os.homedir(), '.cloudcli', 'auth.db');

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = DEFAULT_DATABASE_PATH;
}
