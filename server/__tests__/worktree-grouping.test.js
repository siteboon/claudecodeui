import { describe, it, expect } from 'vitest';
import { synthesizeWorktreeInfoFromPath, fixWorktreeDisplayNames } from '../projects.js';

describe('synthesizeWorktreeInfoFromPath', () => {
  it('returns worktree info for a path containing /.claude/worktrees/', () => {
    const result = synthesizeWorktreeInfoFromPath(
      '/home/user/projects/my-repo/.claude/worktrees/greedy-seeking-stardust'
    );
    expect(result).toEqual({
      isWorktree: true,
      worktreeRoot: '/home/user/projects/my-repo/.claude/worktrees/greedy-seeking-stardust',
      mainRepoRoot: '/home/user/projects/my-repo',
      branchName: 'greedy-seeking-stardust',
    });
  });

  it('handles paths with subdirectories after the worktree name', () => {
    const result = synthesizeWorktreeInfoFromPath(
      '/home/user/projects/my-repo/.claude/worktrees/greedy-seeking-stardust/backend'
    );
    expect(result).toEqual({
      isWorktree: true,
      worktreeRoot: '/home/user/projects/my-repo/.claude/worktrees/greedy-seeking-stardust',
      mainRepoRoot: '/home/user/projects/my-repo',
      branchName: 'greedy-seeking-stardust',
    });
  });

  it('returns null for paths without worktree markers', () => {
    expect(synthesizeWorktreeInfoFromPath('/home/user/projects/my-repo')).toBeNull();
    expect(synthesizeWorktreeInfoFromPath('/home/user/projects/my-repo/backend')).toBeNull();
  });

  it('returns null for paths with a different marker pattern', () => {
    expect(synthesizeWorktreeInfoFromPath('/home/user/projects/my-repo/.claude-worktrees/foo')).toBeNull();
  });
});

describe('fixWorktreeDisplayNames', () => {
  it('renames children whose displayName equals branchName to mainProject displayName', () => {
    const mainProject = { displayName: 'my-repo', fullPath: '/repo', isCustomName: false, worktreeInfo: null };
    const child = {
      displayName: 'greedy-seeking-stardust',
      fullPath: '/worktrees/greedy-seeking-stardust',
      isCustomName: false,
      worktreeInfo: {
        worktreeRoot: '/worktrees/greedy-seeking-stardust',
        branchName: 'greedy-seeking-stardust',
      },
    };
    const grouped = [mainProject, child];

    fixWorktreeDisplayNames(grouped, mainProject);

    expect(child.displayName).toBe('my-repo');
  });

  it('preserves relative subdirectory path for sub-worktree paths', () => {
    const mainProject = { displayName: 'my-repo', fullPath: '/repo', isCustomName: false, worktreeInfo: null };
    const child = {
      displayName: 'backend',
      fullPath: '/worktrees/greedy-seeking-stardust/backend',
      isCustomName: false,
      worktreeInfo: {
        worktreeRoot: '/worktrees/greedy-seeking-stardust',
        branchName: 'greedy-seeking-stardust',
      },
    };
    const grouped = [mainProject, child];

    fixWorktreeDisplayNames(grouped, mainProject);

    expect(child.displayName).toBe('backend');
  });

  it('does not modify projects with isCustomName', () => {
    const mainProject = { displayName: 'my-repo', fullPath: '/repo', isCustomName: false, worktreeInfo: null };
    const child = {
      displayName: 'My Custom Name',
      fullPath: '/worktrees/greedy-seeking-stardust',
      isCustomName: true,
      worktreeInfo: {
        worktreeRoot: '/worktrees/greedy-seeking-stardust',
        branchName: 'greedy-seeking-stardust',
      },
    };
    const grouped = [mainProject, child];

    fixWorktreeDisplayNames(grouped, mainProject);

    expect(child.displayName).toBe('My Custom Name');
  });

  it('does not modify the mainProject itself', () => {
    const mainProject = {
      displayName: 'my-repo',
      fullPath: '/repo',
      isCustomName: false,
      worktreeInfo: { worktreeRoot: '/repo', branchName: 'main' },
    };
    const grouped = [mainProject];

    fixWorktreeDisplayNames(grouped, mainProject);

    expect(mainProject.displayName).toBe('my-repo');
  });
});
