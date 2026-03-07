/**
 * generate-electron-icons.js
 *
 * Generates platform-specific icon files for Electron packaging.
 * Run this script once before building the desktop app:
 *   node scripts/generate-electron-icons.js
 *
 * Requires: sharp (already in devDependencies)
 * Outputs:
 *   build/icons/icon.png   - 512x512 PNG (Linux / fallback)
 *   build/icons/icon.ico   - Windows icon (multi-size ICO)
 *   build/icons/icon.icns  - macOS icon (requires macOS + iconutil, or manual conversion)
 *
 * For .icns on macOS, use:
 *   iconutil -c icns build/icons/icon.iconset
 *
 * For .ico on Windows/Linux, this script uses png-to-ico via sharp resizes.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcIcon = path.join(__dirname, '../build/icons/icon.png');
const iconsDir = path.join(__dirname, '../build/icons');

// Resize source to multiple sizes for Windows ICO
const winSizes = [16, 24, 32, 48, 64, 128, 256];

async function generatePNGs() {
  for (const size of winSizes) {
    const outPath = path.join(iconsDir, `icon-${size}.png`);
    await sharp(srcIcon).resize(size, size).toFile(outPath);
    console.log(`Generated ${outPath}`);
  }
}

// Generate macOS iconset directory (for use with `iconutil -c icns`)
async function generateMacIconset() {
  const iconsetDir = path.join(iconsDir, 'icon.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });
  const macSizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];
  for (const { name, size } of macSizes) {
    const outPath = path.join(iconsetDir, name);
    await sharp(srcIcon).resize(size, size).toFile(outPath);
    console.log(`Generated ${outPath}`);
  }
  console.log('\nTo generate icon.icns on macOS, run:');
  console.log(`  iconutil -c icns ${iconsetDir} -o ${path.join(iconsDir, 'icon.icns')}`);
}

(async () => {
  console.log('Generating electron icons...');
  await generatePNGs();
  await generateMacIconset();
  console.log('\nDone! For Windows .ico, use a tool like https://icoconvert.com/ with the generated PNGs.');
  console.log('Place icon.ico and icon.icns in build/icons/ before running dist:win / dist:mac.');
})();
