import path from 'node:path';

type DiscoveryDirectoryEntry = {
  name: string;
  isDirectory(): boolean;
};

type DiscoveryFileSystem = {
  readdir(directoryPath: string, options: { withFileTypes: true }): Promise<DiscoveryDirectoryEntry[]>;
  access(candidatePath: string): Promise<void>;
};

// Never hold a repository worth offering and are the most expensive to scan.
const SKIPPED_DIRECTORY_NAMES = new Set([
  'node_modules', 'dist', 'build', 'target', 'vendor', '__pycache__', 'venv', '.venv',
]);
// Levels below the project root that are searched for repositories.
const MAXIMUM_SCAN_DEPTH = 2;
const MAXIMUM_REPOSITORIES = 200;

async function isRepositoryRoot(directoryPath: string, fileSystem: DiscoveryFileSystem): Promise<boolean> {
  try {
    // `.git` is a file for worktrees and submodules, so only existence matters.
    await fileSystem.access(path.join(directoryPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Used by the Git routes to list the repositories a project can show: the
 * project root when it is one, then repositories up to two levels below it.
 * Dot-directories, dependency/build directories and the inside of a found
 * repository are not searched. `path` is relative to the project root with
 * `/` separators and is `''` for the root itself.
 */
export async function discoverRepositories(
  projectRoot: string,
  fileSystem: DiscoveryFileSystem,
): Promise<Array<{ path: string; name: string }>> {
  const repositories: Array<{ path: string; name: string }> = [];
  if (await isRepositoryRoot(projectRoot, fileSystem)) {
    repositories.push({ path: '', name: path.basename(projectRoot) });
  }

  async function scan(directoryPath: string, depth: number): Promise<void> {
    let entries: DiscoveryDirectoryEntry[];
    try {
      entries = await fileSystem.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (repositories.length >= MAXIMUM_REPOSITORIES) {
        return;
      }
      // Symlinked directories report isDirectory() false, which also keeps the scan cycle-free.
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      const entryPath = path.join(directoryPath, entry.name);
      if (await isRepositoryRoot(entryPath, fileSystem)) {
        repositories.push({
          path: path.relative(projectRoot, entryPath).split(path.sep).join('/'),
          name: entry.name,
        });
        continue;
      }
      if (depth < MAXIMUM_SCAN_DEPTH) {
        await scan(entryPath, depth + 1);
      }
    }
  }

  await scan(projectRoot, 1);
  return repositories;
}
