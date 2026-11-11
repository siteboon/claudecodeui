import { describe, expect, it } from 'vitest';

import { resolveRepositorySelection } from '@/modules/git-panel/utils/gitPanelUtils';

const repositories = [
  { path: '', name: 'workspace' },
  { path: 'firmware', name: 'firmware' },
  { path: 'tools/cli', name: 'cli' },
];

describe('resolveRepositorySelection', () => {
  it('keeps a remembered repository that still exists', () => {
    expect(resolveRepositorySelection(repositories, 'tools/cli')).toBe('tools/cli');
  });

  it('falls back to the project root when the remembered one is gone', () => {
    expect(resolveRepositorySelection(repositories, 'removed')).toBe('');
    expect(resolveRepositorySelection(repositories, null)).toBe('');
  });

  it('picks the first nested repository when the root is not one', () => {
    expect(resolveRepositorySelection(repositories.slice(1), 'removed')).toBe('firmware');
  });

  it('trusts the remembered choice before the scan has answered', () => {
    expect(resolveRepositorySelection([], 'firmware')).toBe('firmware');
    expect(resolveRepositorySelection([], null)).toBe('');
  });
});
