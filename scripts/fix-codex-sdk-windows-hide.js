#!/usr/bin/env node
/**
 * Hide the console window @openai/codex-sdk spawns codex.exe with
 *
 * The SDK runs one `codex exec` child process per turn through
 * child_process.spawn without passing windowsHide: true. On Windows that
 * makes the OS allocate a fresh console for the console-subsystem codex.exe,
 * so every Codex turn flashes a cmd window when the server itself has no
 * console (Electron, double-click launch). The SDK offers no option to pass
 * spawn flags through, so the shipped bundle is patched in place.
 *
 * The patch is anchored on the spawn call inside the bundled executor and is
 * skipped with a warning when the anchor is absent (new SDK layout, or the
 * upstream already fixed it), so a silent divergence is impossible.
 *
 * @see https://github.com/openai/codex — sdk/typescript/src/exec.ts
 * @module scripts/fix-codex-sdk-windows-hide
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** The spawn call the bundle uses to launch codex.exe, verbatim. */
const SPAWN_ANCHOR = [
  'spawn(this.executablePath, commandArgs, {',
  '      env,',
  '      signal: args.signal',
  '    });',
].join('\n');

const SPAWN_PATCHED = SPAWN_ANCHOR.replace(
  '{\n      env,',
  '{\n      windowsHide: true,\n      env,',
);

async function patchExecutorBundle() {
  if (process.platform !== 'win32') {
    return;
  }

  const sdkIndex = path.join(
    __dirname, '..', 'node_modules', '@openai', 'codex-sdk', 'dist', 'index.js',
  );

  let source;
  try {
    source = await fs.readFile(sdkIndex, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[postinstall] Warning: could not read ${sdkIndex}: ${err.message}`);
    }
    return;
  }

  if (source.includes(SPAWN_PATCHED)) {
    return;
  }
  if (!source.includes(SPAWN_ANCHOR)) {
    console.warn(
      '[postinstall] Warning: @openai/codex-sdk spawn call not found; skipped the ' +
      'windowsHide patch. Codex turns may flash a console window. If the SDK updated, ' +
      'check whether upstream now passes windowsHide and remove this script if so.',
    );
    return;
  }

  await fs.writeFile(sdkIndex, source.replace(SPAWN_ANCHOR, SPAWN_PATCHED), 'utf8');
  console.log('[postinstall] Patched @openai/codex-sdk to spawn codex.exe with windowsHide');
}

patchExecutorBundle().catch((err) => {
  // A failed patch costs a cosmetic window, not a conversation; never block install.
  console.warn(`[postinstall] Warning: codex-sdk windowsHide patch failed: ${err.message}`);
});
