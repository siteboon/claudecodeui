import { describe, it, expect, vi } from 'vitest';

// Mock the SDK import so the module can load without the actual SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock notification orchestrator
vi.mock('../services/notification-orchestrator.js', () => ({
  createNotificationEvent: vi.fn(),
  notifyRunFailed: vi.fn(),
  notifyRunStopped: vi.fn(),
  notifyUserIfEnabled: vi.fn(),
}));

// Mock adapter
vi.mock('../providers/claude/adapter.js', () => ({
  claudeAdapter: { normalizeMessage: vi.fn(() => []) },
}));

// Mock provider types
vi.mock('../providers/types.js', () => ({
  createNormalizedMessage: vi.fn((msg) => msg),
}));

const { mapCliOptionsToSDK } = await import('../claude-sdk.js');

describe('mapCliOptionsToSDK', () => {
  it('returns sensible defaults when called with no options', () => {
    const result = mapCliOptionsToSDK();
    expect(result.model).toBe('opus');
    expect(result.allowedTools).toEqual([]);
    expect(result.disallowedTools).toEqual([]);
    expect(result.worktree).toBeUndefined();
    expect(result.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
    expect(result.settingSources).toEqual(['project', 'user', 'local']);
  });

  it('maps cwd from options', () => {
    const result = mapCliOptionsToSDK({ cwd: '/some/path' });
    expect(result.cwd).toBe('/some/path');
  });

  it('maps sessionId to resume', () => {
    const result = mapCliOptionsToSDK({ sessionId: 'abc-123' });
    expect(result.resume).toBe('abc-123');
  });

  it('maps custom model', () => {
    const result = mapCliOptionsToSDK({ model: 'opus' });
    expect(result.model).toBe('opus');
  });

  it('maps permissionMode when not default', () => {
    const result = mapCliOptionsToSDK({ permissionMode: 'acceptEdits' });
    expect(result.permissionMode).toBe('acceptEdits');
  });

  it('does not map permissionMode when set to default', () => {
    const result = mapCliOptionsToSDK({ permissionMode: 'default' });
    expect(result.permissionMode).toBeUndefined();
  });

  describe('skipPermissions', () => {
    it('sets bypassPermissions when skipPermissions is true', () => {
      const result = mapCliOptionsToSDK({
        toolsSettings: { skipPermissions: true, allowedTools: [], disallowedTools: [] },
      });
      expect(result.permissionMode).toBe('bypassPermissions');
    });

    it('does not set bypassPermissions in plan mode even if skipPermissions is true', () => {
      const result = mapCliOptionsToSDK({
        permissionMode: 'plan',
        toolsSettings: { skipPermissions: true, allowedTools: [], disallowedTools: [] },
      });
      expect(result.permissionMode).toBe('plan');
    });
  });

  describe('useWorktree', () => {
    it('does not set settings.worktree by default', () => {
      const result = mapCliOptionsToSDK();
      expect(result.settings).toBeUndefined();
    });

    it('does not set settings.worktree when useWorktree is false', () => {
      const result = mapCliOptionsToSDK({
        toolsSettings: { useWorktree: false, allowedTools: [], disallowedTools: [], skipPermissions: false },
      });
      expect(result.settings).toBeUndefined();
    });

    it('passes worktree via settings option when useWorktree is true', () => {
      const result = mapCliOptionsToSDK({
        toolsSettings: { useWorktree: true, allowedTools: [], disallowedTools: [], skipPermissions: false },
      });
      expect(result.settings).toEqual({ worktree: {} });
    });

    it('passes worktree name through settings when provided', () => {
      const result = mapCliOptionsToSDK({
        toolsSettings: {
          useWorktree: true,
          worktreeName: 'feat-x',
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: false,
        },
      });
      expect(result.settings).toEqual({ worktree: { name: 'feat-x' } });
    });

    it('omits worktree name when blank', () => {
      const result = mapCliOptionsToSDK({
        toolsSettings: {
          useWorktree: true,
          worktreeName: '',
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: false,
        },
      });
      expect(result.settings).toEqual({ worktree: {} });
    });

    it('sets worktree alongside other options', () => {
      const result = mapCliOptionsToSDK({
        cwd: '/my/project',
        model: 'opus',
        toolsSettings: {
          useWorktree: true,
          skipPermissions: true,
          allowedTools: ['Read', 'Write'],
          disallowedTools: ['Bash(rm:*)'],
        },
      });
      expect(result.settings).toEqual({ worktree: {} });
      expect(result.permissionMode).toBe('bypassPermissions');
      expect(result.allowedTools).toEqual(['Read', 'Write']);
      expect(result.disallowedTools).toEqual(['Bash(rm:*)']);
      expect(result.cwd).toBe('/my/project');
      expect(result.model).toBe('opus');
    });
  });

  describe('allowedTools and disallowedTools', () => {
    it('passes through allowedTools from settings', () => {
      const result = mapCliOptionsToSDK({
        toolsSettings: { allowedTools: ['Read', 'Write'], disallowedTools: [], skipPermissions: false },
      });
      expect(result.allowedTools).toEqual(['Read', 'Write']);
    });

    it('passes through disallowedTools from settings', () => {
      const result = mapCliOptionsToSDK({
        toolsSettings: { allowedTools: [], disallowedTools: ['Bash(rm:*)'], skipPermissions: false },
      });
      expect(result.disallowedTools).toEqual(['Bash(rm:*)']);
    });

    it('adds plan mode tools when permissionMode is plan', () => {
      const result = mapCliOptionsToSDK({
        permissionMode: 'plan',
        toolsSettings: { allowedTools: ['Read'], disallowedTools: [], skipPermissions: false },
      });
      expect(result.allowedTools).toContain('Read');
      expect(result.allowedTools).toContain('Task');
      expect(result.allowedTools).toContain('exit_plan_mode');
      expect(result.allowedTools).toContain('TodoRead');
      expect(result.allowedTools).toContain('WebFetch');
    });

    it('does not duplicate plan mode tools already in allowedTools', () => {
      const result = mapCliOptionsToSDK({
        permissionMode: 'plan',
        toolsSettings: { allowedTools: ['Read', 'Task'], disallowedTools: [], skipPermissions: false },
      });
      const readCount = result.allowedTools.filter((t) => t === 'Read').length;
      expect(readCount).toBe(1);
    });
  });
});
