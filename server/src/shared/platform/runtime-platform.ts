import type { LineEnding, RuntimePlatform } from './types.js';

// This function maps Node's platform strings into the smaller vocabulary used by the adapter layer.
export function resolveRuntimePlatform(nodePlatform: NodeJS.Platform = process.platform): RuntimePlatform {
  switch (nodePlatform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      // Every non-Windows, non-macOS platform in this project behaves like a POSIX shell target.
      return 'linux';
  }
}

// This helper keeps Windows checks readable at call sites.
export function isWindowsPlatform(platform: RuntimePlatform = resolveRuntimePlatform()): boolean {
  return platform === 'windows';
}

// This helper centralizes the preferred newline style for each platform.
export function getPlatformLineEnding(platform: RuntimePlatform = resolveRuntimePlatform()): LineEnding {
  return isWindowsPlatform(platform) ? 'crlf' : 'lf';
}

// This helper centralizes the preferred path separator for each platform.
export function getPlatformPathSeparator(platform: RuntimePlatform = resolveRuntimePlatform()): '\\' | '/' {
  return isWindowsPlatform(platform) ? '\\' : '/';
}
