#!/usr/bin/env node

// The CLI can reach shared environment constants through its composition root,
// so finish the root environment bootstrap before loading that import graph.
// eslint-disable-next-line boundaries/no-unknown
import '../../load-env.js';

async function runCli(): Promise<number> {
  const { createCliApplication } = await import('./index.js');
  return createCliApplication().run(process.argv.slice(2));
}

runCli().then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('\n❌ Error:', message);
  process.exitCode = 1;
});
