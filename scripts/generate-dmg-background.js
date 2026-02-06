import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const outputDir = join(projectRoot, 'build');

const WIDTH = 660;
const HEIGHT = 400;

// Icon center positions (must match electron-builder.yml contents)
const APP_X = 180;
const APPS_X = 480;
const ICON_Y = 170;

// Arrow parameters
const ARROW_Y = ICON_Y;
const ARROW_START_X = APP_X + 60;
const ARROW_END_X = APPS_X - 60;
const DASH_LEN = 12;
const GAP_LEN = 8;
const ARROW_HEAD_SIZE = 14;

function generateArrowPath() {
  const parts = [];
  let x = ARROW_START_X;
  while (x < ARROW_END_X - ARROW_HEAD_SIZE) {
    const end = Math.min(x + DASH_LEN, ARROW_END_X - ARROW_HEAD_SIZE);
    parts.push(`M ${x} ${ARROW_Y} L ${end} ${ARROW_Y}`);
    x = end + GAP_LEN;
  }
  // Arrowhead
  const tipX = ARROW_END_X;
  const baseX = tipX - ARROW_HEAD_SIZE;
  parts.push(
    `M ${baseX} ${ARROW_Y - ARROW_HEAD_SIZE / 2} L ${tipX} ${ARROW_Y} L ${baseX} ${ARROW_Y + ARROW_HEAD_SIZE / 2}`
  );
  return parts.join(' ');
}

function createSvg(scale) {
  const w = WIDTH * scale;
  const h = HEIGHT * scale;
  const s = scale;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a1b2e"/>
      <stop offset="100%" stop-color="#0d0e1a"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <path d="${generateArrowPath()}"
        stroke="rgba(255,255,255,0.5)" stroke-width="${2}" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
  <text x="${WIDTH / 2}" y="${ICON_Y + 80}"
        text-anchor="middle" fill="rgba(255,255,255,0.6)"
        font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
        font-size="${14}" font-weight="400">
    Drag to Applications to install
  </text>
</svg>`;
}

async function generate() {
  mkdirSync(outputDir, { recursive: true });

  // 1x
  const svg1x = createSvg(1);
  await sharp(Buffer.from(svg1x))
    .png()
    .toFile(join(outputDir, 'dmg-background.png'));
  console.log(`Generated build/dmg-background.png (${WIDTH}x${HEIGHT})`);

  // 2x (Retina)
  const svg2x = createSvg(2);
  await sharp(Buffer.from(svg2x))
    .png()
    .toFile(join(outputDir, 'dmg-background@2x.png'));
  console.log(`Generated build/dmg-background@2x.png (${WIDTH * 2}x${HEIGHT * 2})`);
}

generate().catch((err) => {
  console.error('Failed to generate DMG background:', err);
  process.exit(1);
});
