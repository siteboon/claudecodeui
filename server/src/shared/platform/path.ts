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

/**
 * Normalizes a path into a stable comparison key for the target platform.
 *
 * This helper intentionally does more than separator normalization:
 * it trims incidental whitespace, removes the Windows long-path prefix when
 * present, resolves `.` and `..`, and applies the platform's case rules.
 *
 * The return value is meant for equality checks, map keys, and de-duplication.
 * It should not be used as a display string because Windows casing is lowered
 * on purpose to preserve case-insensitive comparisons.
 */
export function normalizeComparablePath(
  value: string,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return '';
  }

  const withoutLongPathPrefix = trimmedValue.startsWith('\\\\?\\')
    ? trimmedValue.slice(4)
    : trimmedValue;

  // This branch resolves paths using the target platform instead of the host OS.
  const pathModule = isWindowsPlatform(platform) ? path.win32 : path.posix;
  const normalizedInput = normalizePathForPlatform(withoutLongPathPrefix, platform);
  const resolvedPath = pathModule.resolve(pathModule.normalize(normalizedInput));

  return isWindowsPlatform(platform)
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

// This helper compares paths using the case-sensitivity rules of the target platform.
export function arePathsEquivalent(
  left: string,
  right: string,
  platform: RuntimePlatform = resolveRuntimePlatform(),
): boolean {
  return normalizeComparablePath(left, platform) === normalizeComparablePath(right, platform);
}
