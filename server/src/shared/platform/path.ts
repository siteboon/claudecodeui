import path from 'path';

import { getPlatformPathSeparator, isWindowsPlatform, resolveRuntimePlatform } from './runtime-platform.js';
import type { RuntimePlatform } from './types.js';

// This helper converts paths into a portable slash-separated form for logs, keys, and serialized payloads.
export function toPortablePath(value: string): string {
  return value.replace(/\\/g, '/');
}

// This helper rewrites any mixture of separators into the preferred style for the target platform.
export function normalizePathForPlatform(
  value: string,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): string {
  const separator = getPlatformPathSeparator(platform);
  return value.replace(/[\\/]+/g, separator);
}

// This helper compares paths using the case-sensitivity rules of the target platform.
export function arePathsEquivalent(
  left: string,
  right: string,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): boolean {
  // This branch uses the target platform's path semantics instead of the host machine's semantics.
  const pathModule = isWindowsPlatform(platform) ? path.win32 : path.posix;
  const normalizedLeft = pathModule.normalize(normalizePathForPlatform(left, platform));
  const normalizedRight = pathModule.normalize(normalizePathForPlatform(right, platform));

  return isWindowsPlatform(platform)
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
