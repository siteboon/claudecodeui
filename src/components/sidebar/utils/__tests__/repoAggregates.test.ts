import { describe, it, expect } from 'vitest';
import type { Project } from '../../../../types/app';
import {
  getRepoSessions,
  getRepoSessionTotal,
  branchChipColorIndex,
} from '../repoAggregates';

const makeProject = (overrides: Partial<Project> & { name: string }): Project => ({
  displayName: overrides.name,
  fullPath: `/tmp/${overrides.name}`,
  ...overrides,
});

describe('getRepoSessions', () => {
  it('returns sessions across all projects in a repo, sorted by recency descending', () => {
    const main = makeProject({
      name: 'main',
      sessions: [
        { id: 'a', lastActivity: '2026-04-25T10:00:00Z' } as never,
        { id: 'b', lastActivity: '2026-04-25T08:00:00Z' } as never,
      ],
    });
    const wt = makeProject({
      name: 'wt',
      sessions: [{ id: 'c', lastActivity: '2026-04-25T09:00:00Z' } as never],
    });

    const result = getRepoSessions([main, wt], {});
    expect(result.map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('attaches __projectName so the caller knows which worktree owns each session', () => {
    const main = makeProject({
      name: 'main',
      sessions: [{ id: 'a', lastActivity: '2026-04-25T10:00:00Z' } as never],
    });
    const wt = makeProject({
      name: 'wt',
      sessions: [{ id: 'b', lastActivity: '2026-04-25T09:00:00Z' } as never],
    });

    const result = getRepoSessions([main, wt], {});
    expect(result[0].__projectName).toBe('main');
    expect(result[1].__projectName).toBe('wt');
  });

  it('respects additionalSessions for paginated entries', () => {
    const main = makeProject({
      name: 'main',
      sessions: [{ id: 'a', lastActivity: '2026-04-25T10:00:00Z' } as never],
    });

    const result = getRepoSessions([main], {
      main: [{ id: 'extra', lastActivity: '2026-04-25T11:00:00Z' } as never],
    });
    expect(result.map((s) => s.id)).toEqual(['extra', 'a']);
  });

  it('returns [] when no projects have sessions', () => {
    const main = makeProject({ name: 'main', sessions: [] });
    expect(getRepoSessions([main], {})).toEqual([]);
  });
});

describe('getRepoSessionTotal', () => {
  it('sums sessionMeta.total across projects, falling back to sessions length', () => {
    const main = makeProject({
      name: 'main',
      sessions: [{ id: 'a' } as never, { id: 'b' } as never],
      sessionMeta: { total: 8 },
    });
    const wt = makeProject({
      name: 'wt',
      sessions: [{ id: 'c' } as never],
    });

    expect(getRepoSessionTotal([main, wt])).toBe(9); // 8 + 1
  });

  it('falls back to summing all four provider arrays when sessionMeta.total is missing', () => {
    const main = makeProject({
      name: 'main',
      sessions: [{ id: 'a' } as never],
      cursorSessions: [{ id: 'c1' } as never, { id: 'c2' } as never],
      codexSessions: [{ id: 'x1' } as never],
      geminiSessions: [{ id: 'g1' } as never],
    });

    expect(getRepoSessionTotal([main])).toBe(5);
  });
});

describe('branchChipColorIndex', () => {
  it('returns the same index for the same branch name', () => {
    expect(branchChipColorIndex('main')).toBe(branchChipColorIndex('main'));
  });

  it('returns a value in [0, paletteSize)', () => {
    for (const branch of ['main', 'feat/x', 'fix/y', 'release/v1', '']) {
      const v = branchChipColorIndex(branch);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });
});
