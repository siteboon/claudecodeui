import fs from 'node:fs/promises';
import { renderPng } from './logo-svg.js';

const size = 1024;
const assetsDir = 'electron/assets';
const iconPath = 'electron/assets/logo-macos.png';
const icnsPath = 'electron/assets/logo-macos.icns';

await fs.mkdir(assetsDir, { recursive: true });
await fs.writeFile(iconPath, await renderPng(size));

const icnsEntries = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];

const blocks = await Promise.all(icnsEntries.map(async ([type, entrySize]) => {
  const png = await renderPng(entrySize);
  const block = Buffer.alloc(8 + png.length);
  block.write(type, 0, 4, 'ascii');
  block.writeUInt32BE(block.length, 4);
  png.copy(block, 8);
  return block;
}));

const totalLength = 8 + blocks.reduce((sum, block) => sum + block.length, 0);
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(totalLength, 4);

await fs.writeFile(icnsPath, Buffer.concat([header, ...blocks], totalLength));
