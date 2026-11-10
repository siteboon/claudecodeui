import fs from 'node:fs/promises';
import { renderPng } from './logo-svg.js';

// electron-builder resolves a Linux icon set by parsing the size out of each
// filename, so entries must be named <size>x<size>.png.
const iconsDir = 'electron/assets/icons';
const sizes = [16, 32, 48, 64, 128, 256, 512];

await fs.mkdir(iconsDir, { recursive: true });

for (const size of sizes) {
  await fs.writeFile(`${iconsDir}/${size}x${size}.png`, await renderPng(size));
}

console.log(`Wrote ${sizes.length} icons to ${iconsDir}`);
