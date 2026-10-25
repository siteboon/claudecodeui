import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import '@/modules/i18n';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';
import type { PendingPermissionRequest } from '@/shared/types';

/**
 * Codex approval prompts use the same banner as Claude's tool prompts, but
 * Codex keeps its own grants: "remember" asks Codex not to ask again in this
 * chat and must not add a rule to Claude's saved tool permissions.
 */

const request = (context?: unknown): PendingPermissionRequest => ({
  requestId: 'req-1',
  toolName: 'Bash',
  input: { command: 'rm -rf build' },
  context,
  sessionId: 'session-1',
});

afterEach(() => {
  localStorage.clear();
});

test('a Codex prompt offers "Allow for this chat" and saves no Claude rule', () => {
  const decide = vi.fn();
  const grant = vi.fn(() => ({ success: true }));
  render(
    <PermissionRequestsBanner
      pendingPermissionRequests={[request({ provider: 'codex' })]}
      handlePermissionDecision={decide}
      handleGrantToolPermission={grant}
    />,
  );

  assert.equal(screen.queryByText(/Allow rule:/), null);
  fireEvent.click(screen.getByText('Allow for this chat'));
  assert.deepEqual(decide.mock.calls, [['req-1', { allow: true, rememberEntry: 'session' }]]);
  assert.equal(grant.mock.calls.length, 0);
});

test('a Claude prompt still saves its allow rule', () => {
  const decide = vi.fn();
  const grant = vi.fn(() => ({ success: true }));
  render(
    <PermissionRequestsBanner
      pendingPermissionRequests={[request()]}
      handlePermissionDecision={decide}
      handleGrantToolPermission={grant}
    />,
  );

  fireEvent.click(screen.getByText('Allow & remember'));
  assert.deepEqual(grant.mock.calls, [[{ entry: 'Bash(rm:*)', toolName: 'Bash' }]]);
  assert.deepEqual(decide.mock.calls, [[['req-1'], { allow: true, rememberEntry: 'Bash(rm:*)' }]]);
});
