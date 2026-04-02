#!/usr/bin/env node
/**
 * Fix node-pty spawn-helper permissions on macOS
 *
 * This script fixes a known issue with node-pty where the spawn-helper
 * binary is shipped without execute permissions, causing "posix_spawnp failed" errors.
 *
 * @see https://github.com/microsoft/node-pty/issues/850
 * @module scripts/fix-node-pty
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Fixes the spawn-helper binary permissions for node-pty on macOS.
 *
 * The node-pty package ships the spawn-helper binary without execute permissions
 * (644 instead of 755), which causes "posix_spawnp failed" errors when trying
 * to spawn terminal processes.
 *
 * This function:
 * 1. Checks if running on macOS (darwin)
 * 2. Locates spawn-helper binaries for both arm64 and x64 architectures
 * 3. Sets execute permissions (755) on each binary found
 *
 * @async
 * @function fixSpawnHelper
 * @returns {Promise<void>} Resolves when permissions are fixed or skipped
 * @example
 * // Run as postinstall script
 * await fixSpawnHelper();
 */
async function fixSpawnHelper() {
  const nodeModulesPath = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');

  // Only run on macOS
  if (process.platform !== 'darwin') {
    return;
  }

  const darwinDirs = ['darwin-arm64', 'darwin-x64'];

  for (const dir of darwinDirs) {
    const spawnHelperPath = path.join(nodeModulesPath, dir, 'spawn-helper');

    try {
      // Check if file exists
      await fs.access(spawnHelperPath);

      // Make it executable (755)
      await fs.chmod(spawnHelperPath, 0o755);
      console.log(`[postinstall] Fixed permissions for ${spawnHelperPath}`);
    } catch (err) {
      // File doesn't exist or other error - ignore
      if (err.code !== 'ENOENT') {
        console.warn(`[postinstall] Warning: Could not fix ${spawnHelperPath}: ${err.message}`);
      }
    }
  }
}

fixSpawnHelper().catch(console.error);
