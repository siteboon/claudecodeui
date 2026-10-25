import { describe, expect, it } from 'vitest';

import type { WorkbenchHooksStatus, WorkbenchSession } from '@/shared/types';
import {
  INITIAL_POLL_STATE,
  applySessionsError,
  applySessionsSnapshot,
  formatCompactAge,
  getAgentHookState,
  getProjectNameFromPath,
  getStatusBadge,
  groupSessionsByProject,
  shouldOfferHooksConsent,
} from '@/modules/workbench-sessions/utils/workbenchSessionLogic';

function makeSession(overrides: Partial<WorkbenchSession>): WorkbenchSession {
  return {
    id: 's1',
    projectPath: 'D:\\code\\app',
    projectId: null,
    worktreePath: 'D:\\code\\.worktrees\\app\\task',
    branch: 'ws/task',
    baseBranch: 'main',
    agent: 'claude',
    profileId: 'none',
    title: 'Task',
    status: 'running',
    createdAt: '2026-10-25T10:00:00.000Z',
    lastActivityAt: '2026-10-25T10:00:00.000Z',
    cliSessionId: null,
    firstPrompt: '',
    launched: true,
    dirtyFiles: 0,
    ahead: 0,
    unpushed: 0,
    hasUpstream: false,
    worktreeExists: true,
    ...overrides,
  };
}

describe('getStatusBadge', () => {
  it('maps every known status to a distinct label key', () => {
    const keys = (['running', 'waiting', 'done', 'error'] as const).map((s) => getStatusBadge(s).labelKey);
    expect(new Set(keys).size).toBe(4);
    expect(getStatusBadge('waiting').pulse).toBe(true);
    expect(getStatusBadge('done').pulse).toBe(false);
  });

  it('falls back to running for unknown statuses', () => {
    expect(getStatusBadge('mystery')).toEqual(getStatusBadge('running'));
  });
});

describe('getProjectNameFromPath', () => {
  it('handles windows, posix and trailing separators', () => {
    expect(getProjectNameFromPath('D:\\03 Business\\Programming\\workbench')).toBe('workbench');
    expect(getProjectNameFromPath('/home/me/app/')).toBe('app');
    expect(getProjectNameFromPath('')).toBe('');
  });
});

describe('groupSessionsByProject', () => {
  it('groups by project and orders sessions and groups by newest activity', () => {
    const groups = groupSessionsByProject([
      makeSession({ id: 'a1', projectPath: '/p/a', lastActivityAt: '2026-10-25T10:00:00Z' }),
      makeSession({ id: 'b1', projectPath: '/p/b', lastActivityAt: '2026-10-25T12:00:00Z' }),
      makeSession({ id: 'a2', projectPath: '/p/a', lastActivityAt: '2026-10-25T11:00:00Z' }),
    ]);
    expect(groups.map((g) => g.projectName)).toEqual(['b', 'a']);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(['a2', 'a1']);
  });

  it('returns no groups for no sessions', () => {
    expect(groupSessionsByProject([])).toEqual([]);
  });
});

describe('formatCompactAge', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  it('formats seconds, minutes, hours and days', () => {
    expect(formatCompactAge('2026-10-25T11:59:50Z', now)).toBe('now');
    expect(formatCompactAge('2026-10-25T11:55:00Z', now)).toBe('5m');
    expect(formatCompactAge('2026-10-25T09:00:00Z', now)).toBe('3h');
    expect(formatCompactAge('2026-10-23T12:00:00Z', now)).toBe('2d');
  });
  it('returns an empty string for invalid timestamps', () => {
    expect(formatCompactAge('nope', now)).toBe('');
  });
});

describe('applySessionsSnapshot', () => {
  it('never notifies on the first snapshot', () => {
    const { state, notify } = applySessionsSnapshot(INITIAL_POLL_STATE, [makeSession({ status: 'waiting' })]);
    expect(notify).toEqual([]);
    expect(state.statusById).toEqual({ s1: 'waiting' });
  });

  it('notifies when a session switches into waiting or done', () => {
    const first = applySessionsSnapshot(INITIAL_POLL_STATE, [
      makeSession({ id: 'a', status: 'running' }),
      makeSession({ id: 'b', status: 'running' }),
      makeSession({ id: 'c', status: 'running' }),
    ]);
    const second = applySessionsSnapshot(first.state, [
      makeSession({ id: 'a', status: 'waiting' }),
      makeSession({ id: 'b', status: 'done' }),
      makeSession({ id: 'c', status: 'error' }),
    ]);
    expect(second.notify.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('does not repeat a notification while the status stays the same', () => {
    const first = applySessionsSnapshot(INITIAL_POLL_STATE, [makeSession({ status: 'running' })]);
    const second = applySessionsSnapshot(first.state, [makeSession({ status: 'waiting' })]);
    const third = applySessionsSnapshot(second.state, [makeSession({ status: 'waiting' })]);
    expect(second.notify).toHaveLength(1);
    expect(third.notify).toHaveLength(0);
  });

  it('does not notify for sessions that first appear after the initial snapshot', () => {
    const first = applySessionsSnapshot(INITIAL_POLL_STATE, []);
    const second = applySessionsSnapshot(first.state, [makeSession({ status: 'done' })]);
    expect(second.notify).toEqual([]);
  });

  it('keeps the last good sessions and status history on error, then clears the error', () => {
    const ok = applySessionsSnapshot(INITIAL_POLL_STATE, [makeSession({ status: 'running' })]);
    const failed = applySessionsError(ok.state, 'offline');
    expect(failed.sessions).toHaveLength(1);
    expect(failed.error).toBe('offline');
    const recovered = applySessionsSnapshot(failed, [makeSession({ status: 'waiting' })]);
    expect(recovered.state.error).toBeNull();
    expect(recovered.notify).toHaveLength(1);
  });
});

function makeHooksStatus(claude: boolean, codex: boolean): WorkbenchHooksStatus {
  return {
    installed: claude,
    settingsPath: 'C:/u/.claude/settings.json',
    agents: {
      claude: { installed: claude, settingsPath: 'C:/u/.claude/settings.json' },
      codex: { installed: codex, settingsPath: 'C:/u/.codex/hooks.json' },
    },
  };
}

describe('getAgentHookState', () => {
  it('reads each agent from the agents map', () => {
    const status = makeHooksStatus(true, false);
    expect(getAgentHookState(status, 'claude')).toEqual({ installed: true, settingsPath: 'C:/u/.claude/settings.json' });
    expect(getAgentHookState(status, 'codex')).toEqual({ installed: false, settingsPath: 'C:/u/.codex/hooks.json' });
  });

  it('falls back to the top-level Claude fields from an older server', () => {
    const legacy = { installed: true, settingsPath: '/h/.claude/settings.json' } as WorkbenchHooksStatus;
    expect(getAgentHookState(legacy, 'claude')).toEqual({ installed: true, settingsPath: '/h/.claude/settings.json' });
    expect(getAgentHookState(legacy, 'codex')).toEqual({ installed: false, settingsPath: '' });
  });
});

describe('shouldOfferHooksConsent', () => {
  it('offers while any agent lacks hooks', () => {
    expect(shouldOfferHooksConsent(makeHooksStatus(true, false), false)).toBe(true);
    expect(shouldOfferHooksConsent(makeHooksStatus(false, true), false)).toBe(true);
  });

  it('stays quiet when everything is installed or the user declined', () => {
    expect(shouldOfferHooksConsent(makeHooksStatus(true, true), false)).toBe(false);
    expect(shouldOfferHooksConsent(makeHooksStatus(false, false), true)).toBe(false);
  });
});
