import { describe, expect, it } from 'vitest';

import type { SessionWithProvider } from '../components/sidebar/types/types';

import { groupConversationsByDate } from './useConversationGroups';

function makeSession(overrides: Partial<SessionWithProvider> & { id: string }): SessionWithProvider {
  return {
    __provider: 'claude',
    ...overrides,
  } as SessionWithProvider;
}

describe('groupConversationsByDate', () => {
  it('returns empty array for empty input', () => {
    const result = groupConversationsByDate([]);
    expect(result).toEqual([]);
  });

  it('groups a session from today into "Today"', () => {
    const now = new Date();
    const session = makeSession({ id: 's1', lastActivity: now.toISOString() });
    const groups = groupConversationsByDate([session]);

    expect(groups.length).toBe(1);
    expect(groups[0].group).toBe('today');
    expect(groups[0].label).toBe('Today');
    expect(groups[0].sessions).toHaveLength(1);
    expect(groups[0].sessions[0].id).toBe('s1');
  });

  it('groups a session from yesterday into "Yesterday"', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    const session = makeSession({ id: 's2', lastActivity: yesterday.toISOString() });
    const groups = groupConversationsByDate([session]);

    expect(groups.length).toBe(1);
    expect(groups[0].group).toBe('yesterday');
    expect(groups[0].label).toBe('Yesterday');
  });

  it('groups sessions into "Previous 7 Days" for 3 days ago', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(12, 0, 0, 0);
    const session = makeSession({ id: 's3', lastActivity: threeDaysAgo.toISOString() });
    const groups = groupConversationsByDate([session]);

    expect(groups.length).toBe(1);
    expect(groups[0].group).toBe('previous7days');
    expect(groups[0].label).toBe('Previous 7 Days');
  });

  it('groups sessions into "Previous 30 Days" for 15 days ago', () => {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    fifteenDaysAgo.setHours(12, 0, 0, 0);
    const session = makeSession({ id: 's4', lastActivity: fifteenDaysAgo.toISOString() });
    const groups = groupConversationsByDate([session]);

    expect(groups.length).toBe(1);
    expect(groups[0].group).toBe('previous30days');
    expect(groups[0].label).toBe('Previous 30 Days');
  });

  it('groups sessions older than 30 days by "Month Year"', () => {
    const old = new Date(2024, 0, 15); // Jan 15, 2024
    const session = makeSession({ id: 's5', lastActivity: old.toISOString() });
    const groups = groupConversationsByDate([session]);

    expect(groups.length).toBe(1);
    expect(groups[0].group).toBe('January 2024');
    expect(groups[0].label).toBe('January 2024');
  });

  it('sorts sessions within a group by newest first', () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 3600000); // 1 hour ago
    const s1 = makeSession({ id: 'newer', lastActivity: now.toISOString() });
    const s2 = makeSession({ id: 'older', lastActivity: earlier.toISOString() });
    const groups = groupConversationsByDate([s2, s1]);

    expect(groups[0].sessions[0].id).toBe('newer');
    expect(groups[0].sessions[1].id).toBe('older');
  });

  it('preserves group ordering: today before yesterday before older', () => {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 5);
    weekAgo.setHours(12, 0, 0, 0);

    const sessions = [
      makeSession({ id: 'week', lastActivity: weekAgo.toISOString() }),
      makeSession({ id: 'today', lastActivity: now.toISOString() }),
      makeSession({ id: 'yesterday', lastActivity: yesterday.toISOString() }),
    ];
    const groups = groupConversationsByDate(sessions);

    expect(groups.length).toBe(3);
    expect(groups[0].group).toBe('today');
    expect(groups[1].group).toBe('yesterday');
    expect(groups[2].group).toBe('previous7days');
  });

  it('falls back to createdAt when lastActivity is missing', () => {
    const now = new Date();
    const session = makeSession({ id: 's6', createdAt: now.toISOString() });
    const groups = groupConversationsByDate([session]);

    expect(groups.length).toBe(1);
    expect(groups[0].group).toBe('today');
  });

  it('hides pinned sessions from date groups when pinnedIds is provided', () => {
    const now = new Date();
    const s1 = makeSession({ id: 'pinned', lastActivity: now.toISOString() });
    const s2 = makeSession({ id: 'normal', lastActivity: now.toISOString() });
    const groups = groupConversationsByDate([s1, s2], new Set(['pinned']));

    const pinned = groups.find(g => g.group === 'pinned');
    expect(pinned).toBeDefined();
    expect(pinned!.label).toBe('Pinned');
    expect(pinned!.sessions).toHaveLength(1);
    expect(pinned!.sessions[0].id).toBe('pinned');

    const today = groups.find(g => g.group === 'today');
    expect(today).toBeDefined();
    expect(today!.sessions).toHaveLength(1);
    expect(today!.sessions[0].id).toBe('normal');
  });
});
