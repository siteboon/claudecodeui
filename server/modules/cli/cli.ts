#!/usr/bin/env node

import { createCliApplication } from './index.js';

const cliApplication = createCliApplication();

cliApplication.run(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('\n❌ Error:', message);
  process.exitCode = 1;
});
