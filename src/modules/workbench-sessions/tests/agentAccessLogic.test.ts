import { describe, expect, it } from 'vitest';

import type { WorkbenchAgentToken, WorkbenchProposal } from '@/shared/types';
import {
  countPendingProposals,
  formatPendingBadge,
  groupProposals,
  maskToken,
  sortTokens,
} from '@/modules/workbench-sessions/utils/agentAccessLogic';

function proposal(overrides: Partial<WorkbenchProposal>): WorkbenchProposal {
  return {
    id: 'p',
    tokenName: 'hermes',
    projectName: 'app',
    agent: 'claude',
    title: 'Do a thing',
    prompt: 'Do the thing',
    baseBranch: null,
    status: 'pending',
    createdAt: '2026-10-25T10:00:00.000Z',
    decidedAt: null,
    sessionId: null,
    note: null,
    ...overrides,
  };
}

function token(overrides: Partial<WorkbenchAgentToken>): WorkbenchAgentToken {
  return { id: 't', name: 'one', createdAt: '2026-10-25T10:00:00.000Z', lastUsedAt: null, revoked: false, ...overrides };
}

describe('groupProposals', () => {
  it('puts pending first, oldest first, and decided newest decision first', () => {
    const { pending, decided } = groupProposals([
      proposal({ id: 'new-pending', createdAt: '2026-10-25T12:00:00Z' }),
      proposal({ id: 'old-pending', createdAt: '2026-10-25T09:00:00Z' }),
      proposal({ id: 'rejected', status: 'rejected', decidedAt: '2026-10-25T13:00:00Z' }),
      proposal({ id: 'approved', status: 'approved', decidedAt: '2026-10-25T14:00:00Z' }),
      proposal({ id: 'expired', status: 'expired', createdAt: '2026-10-20T00:00:00Z', decidedAt: null }),
    ]);
    expect(pending.map((p) => p.id)).toEqual(['old-pending', 'new-pending']);
    expect(decided.map((p) => p.id)).toEqual(['approved', 'rejected', 'expired']);
  });

  it('returns empty groups for no proposals', () => {
    expect(groupProposals([])).toEqual({ pending: [], decided: [] });
  });
});

describe('pending badge', () => {
  it('counts only pending proposals', () => {
    expect(countPendingProposals([])).toBe(0);
    expect(
      countPendingProposals([
        proposal({ status: 'pending' }),
        proposal({ status: 'approved' }),
        proposal({ status: 'pending' }),
        proposal({ status: 'expired' }),
      ]),
    ).toBe(2);
  });

  it('formats nothing for zero, the number to 9, then 9+', () => {
    expect(formatPendingBadge(0)).toBeNull();
    expect(formatPendingBadge(-1)).toBeNull();
    expect(formatPendingBadge(1)).toBe('1');
    expect(formatPendingBadge(9)).toBe('9');
    expect(formatPendingBadge(10)).toBe('9+');
  });
});

describe('sortTokens', () => {
  it('lists active tokens newest first, then revoked ones', () => {
    const sorted = sortTokens([
      token({ id: 'revoked-new', revoked: true, createdAt: '2026-10-25T12:00:00Z' }),
      token({ id: 'old', createdAt: '2026-10-01T00:00:00Z' }),
      token({ id: 'new', createdAt: '2026-10-20T00:00:00Z' }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['new', 'old', 'revoked-new']);
  });

  it('does not mutate its input', () => {
    const input = [token({ id: 'a', revoked: true }), token({ id: 'b' })];
    sortTokens(input);
    expect(input.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('maskToken', () => {
  it('keeps the prefix and last four characters of a long token', () => {
    expect(maskToken('wbt_abcdefghijklmnopqrstuvwxyz')).toBe('wbt_••••••••wxyz');
  });

  it('fully masks short values and never reveals them', () => {
    expect(maskToken('abc')).toBe('••••••');
    expect(maskToken('abcdefghijkl')).not.toContain('abc');
  });
});
