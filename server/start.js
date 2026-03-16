#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distEntrypoint = path.join(__dirname, 'dist', 'bootstrap.js');

if (!fs.existsSync(distEntrypoint)) {
  console.error(
    '[server] Missing built TypeScript server entrypoint at server/dist/bootstrap.js. ' +
    'Run "npm run server" for development or "npm run server:build" before "npm run server:start".'
  );
  process.exit(1);
}

await import('./dist/bootstrap.js');
