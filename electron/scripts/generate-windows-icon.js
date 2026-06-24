#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const assetsDir = 'electron/assets';
const sourcePath = 'public/logo-512.png';
const icoPath = path.join(assetsDir, 'logo-windows.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function writeDirectoryEntry(buffer, image, offset) {
  buffer.writeUInt8(image.size === 256 ? 0 : image.size, offset);
  buffer.writeUInt8(image.size === 256 ? 0 : image.size, offset + 1);
  buffer.writeUInt8(0, offset + 2);
  buffer.writeUInt8(0, offset + 3);
  buffer.writeUInt16LE(1, offset + 4);
  buffer.writeUInt16LE(32, offset + 6);
  buffer.writeUInt32LE(image.buffer.length, offset + 8);
  buffer.writeUInt32LE(image.offset, offset + 12);
}

async function renderPng(size) {
  return sharp(sourcePath)
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer();
}

await fs.mkdir(assetsDir, { recursive: true });

const images = await Promise.all(
  sizes.map(async (size) => ({
    size,
    buffer: await renderPng(size),
    offset: 0,
  })),
);

const headerSize = 6 + images.length * 16;
let cursor = headerSize;
for (const image of images) {
  image.offset = cursor;
  cursor += image.buffer.length;
}

const ico = Buffer.alloc(cursor);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(images.length, 4);

images.forEach((image, index) => {
  writeDirectoryEntry(ico, image, 6 + index * 16);
  image.buffer.copy(ico, image.offset);
});

await fs.writeFile(icoPath, ico);
console.log(`Wrote ${icoPath}`);
