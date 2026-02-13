const isWindows = process.platform === 'win32';

/**
 * Compare two paths for equality (case-insensitive on Windows)
 */
export function pathsEqual(p1, p2) {
  if (isWindows) {
    return p1.toLowerCase() === p2.toLowerCase();
  }
  return p1 === p2;
}

/**
 * Check if a path starts with a prefix (case-insensitive on Windows)
 */
export function pathStartsWith(fullPath, prefix) {
  if (isWindows) {
    return fullPath.toLowerCase().startsWith(prefix.toLowerCase());
  }
  return fullPath.startsWith(prefix);
}
