import type { FileTreeNode } from '@/shared/types';

// A reference written inside a chat message carries neither a canonical
// separator nor a canonical shape, so trailing slashes, `./` prefixes and
// Windows separators are levelled before anything is compared.
const normalizePath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

const isAbsolutePath = (value: string): boolean => /^(\/|[A-Za-z]:\/)/.test(value);

/**
 * The paths to expand, root first, so `reference` becomes visible in the file
 * tree; empty when the reference is not inside the loaded tree.
 *
 * Each level is looked up by name in the tree that is already loaded, rather
 * than composed as a string: an in-chat reference is usually relative
 * (`decisions/`, as the model wrote it) while every node is keyed by the
 * absolute path the server built with its own platform separator. Expansion
 * stops at the last level actually present, so a folder hidden by `.gitignore`
 * or below the walk depth still opens as far as the tree goes.
 */
export function directoryRevealPaths(
  files: FileTreeNode[],
  projectPath: string,
  reference: string,
): string[] {
  const root = normalizePath(projectPath);
  const target = normalizePath(reference);

  let relative = target;
  if (isAbsolutePath(target)) {
    if (!target.startsWith(`${root}/`)) {
      // Either the project root itself (nothing to expand) or a path outside
      // it — `/workspace/apple` must not be read as a child of `/workspace/app`.
      return [];
    }
    relative = target.slice(root.length + 1);
  }

  const paths: string[] = [];
  let level = files;
  for (const segment of relative.split('/').filter(Boolean)) {
    const directory = level.find((node) => node.type === 'directory' && node.name === segment);
    if (!directory) {
      break;
    }
    paths.push(directory.path);
    level = directory.children ?? [];
  }

  return paths;
}
