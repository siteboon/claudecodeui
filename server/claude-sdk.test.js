import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __testAddClaudeSDKSession,
  __testClearClaudeSDKSessions,
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
