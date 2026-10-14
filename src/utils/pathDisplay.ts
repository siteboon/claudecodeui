/**
 * Collapses a leading home directory in an absolute path to `~`, e.g.
 * `/Users/alex/Documents/repo` → `~/Documents/repo`. The inverse of the
 * server's `expandHomeShorthand`.
 *
 * The original separator is preserved (so Windows `C:\Users\alex\x` →
 * `~\x`), and matching is segment-aware: a sibling like `/Users/alexander`
 * is left untouched when the home dir is `/Users/alex`. Returns the path
 * unchanged when `homedir` is missing or doesn't prefix it.
 */
export function collapseHomePath(absPath: string, homedir: string | null | undefined): string {
  if (!absPath || !homedir) {
    return absPath;
  }

  // Normalize away any trailing separator(s) on the home dir so the boundary
  // check below is exact (`/Users/alex/` and `/Users/alex` behave the same).
  const home = homedir.replace(/[/\\]+$/, '');
  if (!home || !absPath.startsWith(home)) {
    return absPath;
  }

  if (absPath.length === home.length) {
    return '~';
  }

  // Only collapse when the home dir ends on a path boundary, otherwise
  // `/Users/alexander` would wrongly match home `/Users/alex`.
  const boundary = absPath[home.length];
  if (boundary === '/' || boundary === '\\') {
    return `~${absPath.slice(home.length)}`;
  }

  return absPath;
}
