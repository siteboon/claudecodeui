import path from 'path';
import { fileURLToPath } from 'url';

import type { RuntimePaths } from '@/shared/types/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUN_REFACTOR_WITH_SRC = true;

export function getRuntimePaths(): RuntimePaths {
  const serverSrcDir = path.resolve(__dirname, '..');
  const serverDir = path.resolve(serverSrcDir, '..');
  const refactorRuntimePath =
    RUN_REFACTOR_WITH_SRC
      ? path.join(serverDir, 'src', 'runner.ts')
      : path.join(serverDir, 'dist', 'runner.js');

  return {
    serverSrcDir,
    serverDir,
    projectRoot: path.resolve(serverDir, '..'),
    legacyRuntimePath: path.join(serverDir, 'index.js'),
    bootstrapEntrypointPath: path.join(serverDir, 'dist', 'bootstrap.js'),
    refactorRuntimePath
  };
}
