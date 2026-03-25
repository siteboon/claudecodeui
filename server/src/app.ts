import './config/load-env-vars.js';

import { pathToFileURL } from 'url';

import { getRuntimePaths } from '@/config/runtime.js';
import type { ServerApplication } from '@/shared/types/app.js';
import { logger } from '@/shared/utils/logger.js';

export function createServerApplication(): ServerApplication {
  const runtimePaths = getRuntimePaths();
  
  return {
    runtimePaths,
    start: async () => {
      // ----------------------------------------------
      // Legacy backend Runner
      logger.info('Bootstrapping backend via legacy runtime bridge', {
        legacyRuntime: runtimePaths.legacyRuntimePath,
      });
      await import(pathToFileURL(runtimePaths.legacyRuntimePath).href);
      // ----------------------------------------------


      // ----------------------------------------------
      // Refactor backend Runner
      // logger.info('Bootstrapping backend via refactor runtime', {
      //   refactorRuntime: runtimePaths.refactorRuntimePath,
      // });
      // await import(pathToFileURL(runtimePaths.refactorRuntimePath).href);
    },
  };
}
