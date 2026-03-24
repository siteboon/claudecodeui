import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

const { getClaudeSettings, CLAUDE_SETTINGS_KEY } = await import('../chatStorage');

describe('getClaudeSettings', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
  });

  it('returns defaults when localStorage is empty', () => {
    const settings = getClaudeSettings();
    expect(settings).toEqual({
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      useWorktree: false,
      projectSortOrder: 'name',
    });
  });

  it('returns defaults when localStorage has invalid JSON', () => {
    localStorageMock.getItem.mockReturnValueOnce('not-valid-json');
    const settings = getClaudeSettings();
    expect(settings.useWorktree).toBe(false);
    expect(settings.skipPermissions).toBe(false);
    expect(settings.allowedTools).toEqual([]);
  });

  it('reads useWorktree from stored settings', () => {
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({
      useWorktree: true,
      skipPermissions: false,
      allowedTools: ['Read'],
      disallowedTools: [],
      projectSortOrder: 'date',
    }));
    const settings = getClaudeSettings();
    expect(settings.useWorktree).toBe(true);
    expect(settings.allowedTools).toEqual(['Read']);
    expect(settings.projectSortOrder).toBe('date');
  });

  it('defaults useWorktree to false when not present in stored settings', () => {
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({
      skipPermissions: true,
      allowedTools: [],
      disallowedTools: [],
    }));
    const settings = getClaudeSettings();
    expect(settings.useWorktree).toBe(false);
    expect(settings.skipPermissions).toBe(true);
  });

  it('coerces useWorktree to boolean', () => {
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({
      useWorktree: 1,
    }));
    const settings = getClaudeSettings();
    expect(settings.useWorktree).toBe(true);
    expect(typeof settings.useWorktree).toBe('boolean');
  });

  it('handles non-array allowedTools gracefully', () => {
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({
      allowedTools: 'not-an-array',
      disallowedTools: null,
    }));
    const settings = getClaudeSettings();
    expect(settings.allowedTools).toEqual([]);
    expect(settings.disallowedTools).toEqual([]);
  });

  it('reads from the correct localStorage key', () => {
    getClaudeSettings();
    expect(localStorageMock.getItem).toHaveBeenCalledWith(CLAUDE_SETTINGS_KEY);
  });
});
