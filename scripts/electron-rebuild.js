/**
 * electron-rebuild.js
 *
 * Placeholder post-pack hook for electron-builder.
 * Native module rebuild is intentionally disabled in package.json because the
 * installed binaries already load successfully in Electron 40 on Windows.
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
  // Add any additional post-pack steps here if needed.
}
