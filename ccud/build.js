import esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await esbuild.build({
  entryPoints: ['ccud/src/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/ccud.mjs',
  banner: { js: '#!/usr/bin/env node' },
  minify: false, // Keep readable for debugging on remote hosts
  define: {
    'CCUD_VERSION': JSON.stringify(pkg.version),
  },
});

console.error('Daemon bundled to dist/ccud.mjs');
