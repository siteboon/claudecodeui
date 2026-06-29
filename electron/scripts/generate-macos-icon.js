import fs from 'node:fs/promises';
import sharp from 'sharp';

const size = 1024;
const assetsDir = 'electron/assets';
const iconPath = 'electron/assets/logo-macos.png';
const icnsPath = 'electron/assets/logo-macos.icns';

function renderSvg(entrySize) {
  const scale = entrySize / 32;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${entrySize}" height="${entrySize}" viewBox="0 0 ${entrySize} ${entrySize}">
  <rect width="${entrySize}" height="${entrySize}" fill="#2563eb"/>
  <path
    d="M${8 * scale} ${9 * scale}C${8 * scale} ${8.44772 * scale} ${8.44772 * scale} ${8 * scale} ${9 * scale} ${8 * scale}H${23 * scale}C${23.5523 * scale} ${8 * scale} ${24 * scale} ${8.44772 * scale} ${24 * scale} ${9 * scale}V${18 * scale}C${24 * scale} ${18.5523 * scale} ${23.5523 * scale} ${19 * scale} ${23 * scale} ${19 * scale}H${12 * scale}L${8 * scale} ${23 * scale}V${9 * scale}Z"
    stroke="white"
    stroke-width="${2 * scale}"
    stroke-linecap="round"
    stroke-linejoin="round"
    fill="none"
  />
</svg>`;
}

async function renderPng(entrySize) {
  return sharp(Buffer.from(renderSvg(entrySize)))
    .png()
    .toBuffer();
}

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
