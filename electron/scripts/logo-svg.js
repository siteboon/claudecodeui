import sharp from 'sharp';

/** Shared logo artwork used to generate the macOS icns and the Linux icon set. */
export function renderSvg(entrySize) {
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

/** Rasterises the logo to a square PNG buffer of the given edge length. */
export async function renderPng(entrySize) {
  return sharp(Buffer.from(renderSvg(entrySize)))
    .png()
    .toBuffer();
}
