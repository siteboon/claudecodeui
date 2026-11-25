import fs from 'node:fs';
import path from 'node:path';

const LINKED_WORKTREE_GITDIR = /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$/;
const CLOUDCLI_WORKTREE_LAYOUT = /^(.*)[\\/]([^\\/]+)-worktrees[\\/][^\\/]+[\\/]?$/;

/**
 * Returns the main repository a project directory belongs to when that directory is a
 * linked git worktree, so the sidebar can nest worktree projects under their repository.
 *
 * A live worktree is recognised by its `.git` file (`gitdir: <repo>/.git/worktrees/<name>`).
 * Once a worktree is removed its sessions keep the old path, so a missing directory falls
 * back to the `<repo>-worktrees/<name>` layout CloudCLI itself creates worktrees in, but only
 * when `<repo>` is a known project — a guess about an unknown directory is never returned.
 */
export function resolveWorktreeParent(projectPath: string, knownProjectPaths: ReadonlySet<string>): string | null {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(path.join(projectPath, '.git'));
  } catch {
    stat = null;
  }

  if (stat?.isFile()) {
    try {
      const match = fs.readFileSync(path.join(projectPath, '.git'), 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
      const gitdir = match ? path.resolve(projectPath, match[1]) : null;
      const repo = gitdir?.match(LINKED_WORKTREE_GITDIR)?.[1];
      return repo && path.resolve(repo) !== path.resolve(projectPath) ? repo : null;
    } catch {
      return null;
    }
  }
  if (stat || fs.existsSync(projectPath)) {
    return null;
  }

  const layout = projectPath.match(CLOUDCLI_WORKTREE_LAYOUT);
  if (!layout) {
    return null;
  }
  const candidate = path.join(layout[1], layout[2]);
  return knownProjectPaths.has(candidate) ? candidate : null;
}
