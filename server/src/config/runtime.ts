import path from 'path';
import { fileURLToPath } from 'url';

import type { RuntimePaths } from '@/shared/types/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getRuntimePaths(): RuntimePaths {
  const serverSrcDir = path.resolve(__dirname, '..');
  const serverDir = path.resolve(serverSrcDir, '..');

  return {
    serverSrcDir,
    serverDir,
    projectRoot: path.resolve(serverDir, '..'),
    legacyRuntimePath: path.join(serverDir, 'index.js'),
    bootstrapEntrypointPath: path.join(serverDir, 'dist', 'bootstrap.js'),
  };
}
