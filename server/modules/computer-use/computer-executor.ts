import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type Point = { x: number; y: number };
export type ClickButton = 'left' | 'right' | 'middle';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';
export type DisplaySize = { width: number; height: number };

export type RuntimeReadiness = {
  nut: any | null;
  screenshot: any | null;
  nutInstalled: boolean;
  screenshotInstalled: boolean;
};

/**
 * Coordinate space the executor reports/accepts. The screenshot pixel space is
 * the canonical space agents and users address; it is mapped to the nut-js
 * logical mouse space before any action runs.
 */
export type ExecutorTarget = {
  displaySize: DisplaySize | null;
};

export function getNut(): any | null {
  try {
    return require('@nut-tree-fork/nut-js');
  } catch {
    return null;
  }
}

export function getScreenshot(): any | null {
  try {
    const mod = require('screenshot-desktop');
    return mod?.default || mod;
  } catch {
    return null;
  }
}

export function getRuntimeReadiness(): RuntimeReadiness {
  const nut = getNut();
  const screenshot = getScreenshot();
  return {
    nut,
    screenshot,
    nutInstalled: Boolean(nut),
    screenshotInstalled: typeof screenshot === 'function',
  };
}

/** Reads the pixel dimensions from a PNG/JPEG buffer header without decoding it. */
export function readImageSize(buffer: Buffer): DisplaySize | null {
  // PNG: 8-byte signature, then IHDR chunk with width/height as big-endian uint32.
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  // JPEG: scan for a Start-Of-Frame marker (0xFFC0..0xFFCF, excluding C4/C8/CC).
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return null;
}

export async function captureScreenshot(): Promise<{ dataUrl: string; size: DisplaySize | null }> {
  const screenshot = getScreenshot();
  if (typeof screenshot !== 'function') {
    throw new Error('Computer Use runtime is not available.');
  }
  const buffer: Buffer = await screenshot({ format: 'png' });
  return {
    dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    size: readImageSize(buffer),
  };
}

/** Returns the mouse coordinate space size (logical screen pixels). */
export async function getMouseSpaceSize(): Promise<DisplaySize> {
  const nut = getNut();
  if (!nut) {
    throw new Error('Computer Use runtime is not available.');
  }
  const width = await nut.screen.width();
  const height = await nut.screen.height();
  return { width, height };
}

/** Maps a point from screenshot/image space to the mouse coordinate space. */
export async function toMouseSpace(target: ExecutorTarget, point: Point): Promise<Point> {
  const mouseSize = await getMouseSpaceSize();
  const image = target.displaySize || mouseSize;
  const scaleX = image.width ? mouseSize.width / image.width : 1;
  const scaleY = image.height ? mouseSize.height / image.height : 1;
  return {
    x: Math.round(point.x * scaleX),
    y: Math.round(point.y * scaleY),
  };
}

/** Maps a point from the mouse coordinate space back to screenshot/image space. */
export function toImageSpace(target: ExecutorTarget, point: Point, mouseSize: DisplaySize): Point {
  const image = target.displaySize || mouseSize;
  const scaleX = mouseSize.width ? image.width / mouseSize.width : 1;
  const scaleY = mouseSize.height ? image.height / mouseSize.height : 1;
  return {
    x: Math.round(point.x * scaleX),
    y: Math.round(point.y * scaleY),
  };
}

function nutButton(nut: any, button: ClickButton) {
  if (button === 'right') return nut.Button.RIGHT;
  if (button === 'middle') return nut.Button.MIDDLE;
  return nut.Button.LEFT;
}

/** Maps a key name (xdotool-style, as Anthropic's computer tool emits) to a nut-js Key. */
function nutKey(nut: any, token: string): any {
  const map: Record<string, string> = {
    return: 'Enter', enter: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab',
    space: 'Space', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert',
    up: 'Up', down: 'Down', left: 'Left', right: 'Right',
    home: 'Home', end: 'End', pageup: 'PageUp', page_up: 'PageUp', pagedown: 'PageDown', page_down: 'PageDown',
    ctrl: 'LeftControl', control: 'LeftControl', alt: 'LeftAlt', shift: 'LeftShift',
    meta: 'LeftSuper', super: 'LeftSuper', cmd: 'LeftSuper', win: 'LeftSuper',
    capslock: 'CapsLock',
  };
  const lower = token.toLowerCase();
  if (map[lower]) {
    return nut.Key[map[lower]];
  }
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) {
    return nut.Key[`F${lower.slice(1)}`];
  }
  if (token.length === 1) {
    const upper = token.toUpperCase();
    if (nut.Key[upper] !== undefined) {
      return nut.Key[upper];
    }
    if (nut.Key[`Num${token}`] !== undefined && /[0-9]/.test(token)) {
      return nut.Key[`Num${token}`];
    }
  }
  throw new Error(`Unsupported key: ${token}`);
}

/**
 * The cross-platform OS executor. It is intentionally free of any server,
 * database, or session dependencies so it can run both inside the local server
 * process (OSS mode) and inside the standalone desktop agent (cloud relay).
 */
export const executor = {
  async configure() {
    const nut = getNut();
    if (nut) {
      // Make actions responsive; the agent loop already paces itself with screenshots.
      nut.mouse.config.autoDelayMs = 2;
      nut.keyboard.config.autoDelayMs = 2;
    }
    return nut;
  },

  async cursorPosition(target: ExecutorTarget): Promise<Point> {
    const nut = await this.configure();
    const mouseSize = await getMouseSpaceSize();
    const pos = await nut.mouse.getPosition();
    return toImageSpace(target, { x: pos.x, y: pos.y }, mouseSize);
  },

  async moveTo(target: ExecutorTarget, point: Point): Promise<void> {
    const nut = await this.configure();
    const dest = await toMouseSpace(target, point);
    await nut.mouse.setPosition(new nut.Point(dest.x, dest.y));
  },

  async click(target: ExecutorTarget, button: ClickButton, point?: Point, doubleClick = false): Promise<void> {
    const nut = await this.configure();
    if (point) {
      await this.moveTo(target, point);
    }
    if (doubleClick) {
      await nut.mouse.doubleClick(nutButton(nut, button));
    } else {
      await nut.mouse.click(nutButton(nut, button));
    }
  },

  async drag(target: ExecutorTarget, from: Point, to: Point, button: ClickButton = 'left'): Promise<void> {
    const nut = await this.configure();
    const start = await toMouseSpace(target, from);
    const end = await toMouseSpace(target, to);
    await nut.mouse.setPosition(new nut.Point(start.x, start.y));
    await nut.mouse.pressButton(nutButton(nut, button));
    await nut.mouse.setPosition(new nut.Point(end.x, end.y));
    await nut.mouse.releaseButton(nutButton(nut, button));
  },

  async type(text: string): Promise<void> {
    const nut = await this.configure();
    await nut.keyboard.type(text);
  },

  async pressChord(chord: string): Promise<void> {
    const nut = await this.configure();
    const tokens = chord.split('+').map((token) => token.trim()).filter(Boolean);
    if (tokens.length === 0) {
      return;
    }
    const keys = tokens.map((token) => nutKey(nut, token));
    for (const key of keys) {
      await nut.keyboard.pressKey(key);
    }
    for (const key of [...keys].reverse()) {
      await nut.keyboard.releaseKey(key);
    }
  },

  async scroll(target: ExecutorTarget, direction: ScrollDirection, amount: number, point?: Point): Promise<void> {
    const nut = await this.configure();
    if (point) {
      await this.moveTo(target, point);
    }
    const steps = Math.max(1, Math.round(amount));
    if (direction === 'up') await nut.mouse.scrollUp(steps);
    else if (direction === 'down') await nut.mouse.scrollDown(steps);
    else if (direction === 'left') await nut.mouse.scrollLeft(steps);
    else await nut.mouse.scrollRight(steps);
  },
};
