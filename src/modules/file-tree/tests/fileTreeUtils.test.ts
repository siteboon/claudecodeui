import { describe, expect, it } from 'vitest';

import { findFileTreeNode, replaceDirectoryChildren } from '@/modules/file-tree/utils/fileTreeUtils';
import type { FileTreeNode } from '@/shared/types';

const tree: FileTreeNode[] = [
  {
    name: 'src',
    type: 'directory',
    path: '/p/src',
    children: [
      { name: 'nested', type: 'directory', path: '/p/src/nested', childrenLoaded: false },
      { name: 'index.ts', type: 'file', path: '/p/src/index.ts' },
    ],
  },
  { name: 'docs', type: 'directory', path: '/p/docs', childrenLoaded: false },
  { name: 'README.md', type: 'file', path: '/p/README.md' },
];

describe('findFileTreeNode', () => {
  it('finds nested directories by path', () => {
    expect(findFileTreeNode(tree, '/p/src/nested')?.name).toBe('nested');
    expect(findFileTreeNode(tree, '/p/docs')?.childrenLoaded).toBe(false);
  });

  it('returns null for unknown paths', () => {
    expect(findFileTreeNode(tree, '/p/missing')).toBeNull();
  });
});

describe('replaceDirectoryChildren', () => {
  it('fills the directory and marks it loaded without touching siblings', () => {
    const children: FileTreeNode[] = [{ name: 'deep.ts', type: 'file', path: '/p/src/nested/deep.ts' }];

    const next = replaceDirectoryChildren(tree, '/p/src/nested', children);

    const nested = findFileTreeNode(next, '/p/src/nested');
    expect(nested?.children).toBe(children);
    expect(nested?.childrenLoaded).toBe(true);
    expect(next).not.toBe(tree);
    expect(next[1]).toBe(tree[1]);
    expect(next[0]?.children?.[1]).toBe(tree[0]?.children?.[1]);
  });

  it('returns the same array when the directory is not in the tree', () => {
    expect(replaceDirectoryChildren(tree, '/p/gone', [])).toBe(tree);
  });
});
