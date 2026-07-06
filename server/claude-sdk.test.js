import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __testAddClaudeSDKSession,
  __testClearClaudeSDKSessions,
  __testMapCliOptionsToSDK,
  __testResolveClaudeToolApprovalTimeoutMs,
  __testResolveImmediateToolDecision,
  __testRemoveClaudeSDKSession,
  getActiveClaudeSDKSessions,
} from './claude-sdk.js';

test('Claude SDK session registry interrupts replaced instances and ignores stale cleanup', async () => {
  __testClearClaudeSDKSessions();

  let interrupted = 0;
  const firstInstance = {
    interrupt: async () => {
      interrupted += 1;
    },
  };
  const secondInstance = {
    interrupt: async () => {},
  };

  __testAddClaudeSDKSession('claude-native-1', firstInstance);
  __testAddClaudeSDKSession('claude-native-1', secondInstance);

  assert.equal(interrupted, 1);
  assert.deepEqual(getActiveClaudeSDKSessions(), ['claude-native-1']);

  __testRemoveClaudeSDKSession('claude-native-1', firstInstance);
  assert.deepEqual(getActiveClaudeSDKSessions(), ['claude-native-1']);

  __testRemoveClaudeSDKSession('claude-native-1', secondInstance);
  assert.deepEqual(getActiveClaudeSDKSessions(), []);
});

test('Claude tool approval timeout can be disabled with zero', () => {
  assert.equal(
    __testResolveClaudeToolApprovalTimeoutMs({ CLAUDE_TOOL_APPROVAL_TIMEOUT_MS: '0' }),
    0,
  );
  assert.equal(
    __testResolveClaudeToolApprovalTimeoutMs({ CLAUDE_TOOL_APPROVAL_TIMEOUT_MS: '-1' }),
    0,
  );
  assert.equal(
    __testResolveClaudeToolApprovalTimeoutMs({ CLAUDE_TOOL_APPROVAL_TIMEOUT_MS: '1500' }),
    1500,
  );
  assert.equal(
    __testResolveClaudeToolApprovalTimeoutMs({ CLAUDE_TOOL_APPROVAL_TIMEOUT_MS: 'invalid' }),
    55000,
  );
});

test('Claude bypass permission mode auto-allows every tool without prompting', () => {
  const input = { question: 'Continue?' };
  assert.deepEqual(
    __testResolveImmediateToolDecision(
      {
        permissionMode: 'bypassPermissions',
        allowedTools: [],
        disallowedTools: [],
      },
      'AskUserQuestion',
      input,
    ),
    { behavior: 'allow', updatedInput: input },
  );
});

test('Claude SDK maps stale concrete Opus model id to Claude Code alias', () => {
  const sdkOptions = __testMapCliOptionsToSDK({ model: 'claude-opus-4-8' });
  assert.equal(sdkOptions.model, 'opus');
});

test('Claude SDK maps worktree permission setting to SDK settings', () => {
  const sdkOptions = __testMapCliOptionsToSDK({
    toolsSettings: {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      useWorktree: true,
    },
  });

  assert.deepEqual(sdkOptions.settings, {
    worktree: {},
  });
});

test('Claude SDK maps named worktree permission setting to SDK settings', () => {
  const sdkOptions = __testMapCliOptionsToSDK({
    toolsSettings: {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      useWorktree: true,
      worktreeName: 'feature-x',
    },
  });

  assert.deepEqual(sdkOptions.settings, {
    worktree: { name: 'feature-x' },
  });
});
