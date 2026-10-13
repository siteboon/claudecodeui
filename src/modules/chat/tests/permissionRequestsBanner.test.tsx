import assert from 'node:assert/strict';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';
import type { PendingPermissionRequest } from '@/shared/types';

function createRequest(
  requestId: string,
  sessionId?: string | null,
  provider: PendingPermissionRequest['provider'] = 'codex',
): PendingPermissionRequest {
  return { requestId, sessionId, provider, toolName: 'Bash', input: { command: 'npm test' } };
}

test('Allow for session approves only the selected Codex request, not matching prefixes or sessions', () => {
  const handlePermissionDecision = vi.fn();
  const handleGrantToolPermission = vi.fn(() => ({ success: true }));
  const staleRequest = createRequest('stale', 'session-old');
  const view = render(
    <PermissionRequestsBanner
      pendingPermissionRequests={[staleRequest]}
      handlePermissionDecision={handlePermissionDecision}
      handleGrantToolPermission={handleGrantToolPermission}
    />,
  );
  view.rerender(
    <PermissionRequestsBanner
      pendingPermissionRequests={[
        createRequest('active', 'session-new'),
        createRequest('same-session', 'session-new'),
        { ...createRequest('unreviewed-command', 'session-new'), input: { command: 'npm exec unreviewed-command' } },
        staleRequest,
        createRequest('other-provider', 'session-new', 'claude'),
        { ...createRequest('other-tool', 'session-new'), input: { command: 'git status' } },
      ]}
      handlePermissionDecision={handlePermissionDecision}
      handleGrantToolPermission={handleGrantToolPermission}
    />,
  );

  fireEvent.click(screen.getAllByRole('button', { name: 'Allow for session' })[0]);

  assert.deepEqual(handlePermissionDecision.mock.calls, [[
    ['active'],
    { allow: true, rememberEntry: 'Bash(npm:*)' },
  ]]);
  assert.equal(handleGrantToolPermission.mock.calls.length, 0);
});

for (const sessionId of [undefined, null, '']) {
  test(`Allow for session affects only one request when sessionId is ${String(sessionId)}`, () => {
    const handlePermissionDecision = vi.fn();
    render(
      <PermissionRequestsBanner
        pendingPermissionRequests={[
          createRequest('selected', sessionId),
          createRequest('also-unscoped', sessionId),
          createRequest('scoped', 'session-other'),
        ]}
        handlePermissionDecision={handlePermissionDecision}
        handleGrantToolPermission={() => ({ success: true })}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Allow for session' })[0]);

    assert.deepEqual(handlePermissionDecision.mock.calls[0]?.[0], ['selected']);
  });
}

test('remembering a Claude rule does not approve matching Codex requests', () => {
  const handlePermissionDecision = vi.fn();
  const handleGrantToolPermission = vi.fn(() => ({ success: true }));
  render(
    <PermissionRequestsBanner
      pendingPermissionRequests={[
        createRequest('claude', 'session-1', 'claude'),
        createRequest('second-claude', 'session-1', 'claude'),
        createRequest('codex', 'session-1'),
      ]}
      handlePermissionDecision={handlePermissionDecision}
      handleGrantToolPermission={handleGrantToolPermission}
    />,
  );

  fireEvent.click(screen.getAllByRole('button', { name: 'Allow & remember' })[0]);

  assert.deepEqual(handlePermissionDecision.mock.calls[0]?.[0], ['claude', 'second-claude']);
  assert.deepEqual(handleGrantToolPermission.mock.calls, [[{ entry: 'Bash(npm:*)', toolName: 'Bash' }]]);
});

for (const action of ['Allow once', 'Deny']) {
  test(`${action} affects only the selected Codex request`, () => {
    const handlePermissionDecision = vi.fn();
    render(
      <PermissionRequestsBanner
        pendingPermissionRequests={[
          createRequest('selected', 'session-1'),
          createRequest('unreviewed', 'session-1'),
        ]}
        handlePermissionDecision={handlePermissionDecision}
        handleGrantToolPermission={() => ({ success: true })}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: action })[0]);

    assert.equal(handlePermissionDecision.mock.calls.length, 1);
    assert.equal(handlePermissionDecision.mock.calls[0]?.[0], 'selected');
    assert.equal(handlePermissionDecision.mock.calls[0]?.[1].allow, action === 'Allow once');
  });
}
