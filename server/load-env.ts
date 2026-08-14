// Load environment variables from .env before other imports execute.
import fs from 'fs';
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

// Resolve the repo/app root via the nearest /server folder so this file keeps finding the
// same top-level .env file from both /server/load-env.ts and /dist-server/server/load-env.js.
const APP_ROOT = getBootstrapApplicationRoot(import.meta.url);

try {
  const envPath = path.join(APP_ROOT, '.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();

        // A real environment variable outranks `.env`, but silently ignoring a
        // DATABASE_PATH the user wrote in `.env` is how a checkout ends up
        // attached to another instance's database. Say so instead.
        if (process.env[key] !== undefined) {
          if (key === 'DATABASE_PATH' && process.env[key] !== value) {
            console.warn(
              `[env] Ignoring DATABASE_PATH=${value} from ${envPath}: the inherited ` +
              `environment already sets DATABASE_PATH=${process.env[key]}, which takes ` +
              'precedence. Unset it in the parent process to use the .env value.',
            );
          }
          return;
        }

        process.env[key] = value;
      }
    }
  });
} catch (e: any) {
  console.error('No .env file found or error reading it:', e.message);
}

// The default database path is intentionally NOT written back to process.env.
// It lives in server/shared/database-path.ts and is applied when the connection
// is opened: writing it here would leak it to every spawned child process, so a
// dev server launched from an in-app terminal would attach to the running
// production database.
