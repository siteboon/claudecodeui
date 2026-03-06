/**
 * electron-rebuild.js
 *
 * Post-pack hook for electron-builder.
 * electron-builder already calls `@electron/rebuild` automatically via `npmRebuild: true`
 * in the build config, so native modules (node-pty, better-sqlite3, bcrypt, sqlite3)
 * are rebuilt for the target Electron version before packaging.
 *
 * This file exists as a reference/extension point for additional post-pack steps.
 * To activate as an afterPack hook, add to package.json build config:
 *   "afterPack": "scripts/electron-rebuild.js"
 *
 * The hook receives: { appOutDir, packager, outDir, electronPlatformName, arch }
 */
export default async function afterPack(context) {
  const { electronPlatformName, arch } = context;
  console.log(`[afterPack] Platform: ${electronPlatformName}, Arch: ${arch}`);
  // Native modules are rebuilt by electron-builder's npmRebuild: true setting.
  // Add any additional post-pack steps here if needed.
}
