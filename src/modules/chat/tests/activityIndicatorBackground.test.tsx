import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import '@/modules/i18n';
import ActivityIndicator from '@/modules/chat/composer/ActivityIndicator';
import type { BackgroundTaskSummary, SessionActivity } from '@/shared/types';

/**
 * The pill above the composer used to vanish at the turn's `complete` even
 * when the CLI stayed open for the agents, workflows or commands the turn
 * launched. A background-only entry now keeps it up, named for the work and
 * in the purple of the workflow and agent cards — with no Stop, because
 * nothing is responding and the composer can send.
 */

const task = (overrides: Partial<BackgroundTaskSummary> = {}): BackgroundTaskSummary => ({
  taskId: 'wxkj4kcvd',
  toolUseId: 'toolu_workflow_1',
  taskType: 'local_workflow',
  description: 'Audit the frontend',
  workflowName: 'frontend-architecture-audit',
  startedAt: Date.now() - 65_000,
  ...overrides,
});

const backgroundActivity = (tasks: BackgroundTaskSummary[]): SessionActivity => ({
  statusText: null,
  canInterrupt: false,
  startedAt: Math.min(...tasks.map((entry) => entry.startedAt)),
  background: true,
  tasks,
});

test('a background-only session names its workflow, counts from its start and offers no Stop', () => {
  const onAbort = vi.fn();
  const { container } = render(<ActivityIndicator activity={backgroundActivity([task()])} onAbort={onAbort} />);

  assert.match(container.textContent ?? '', /Background work…/);
  assert.match(container.textContent ?? '', /Workflow frontend-architecture-audit/);
  assert.match(container.textContent ?? '', /1m 5s/, 'elapsed since the task started, not since the pill mounted');
  assert.equal(screen.queryByRole('button', { name: 'Stop' }), null);
  assert.ok(container.querySelector('.bg-purple-500'), 'the dot is the cards\' purple, not the primary colour');
});

test('an agent and a command are named by what they were asked to do; several tasks by their count', () => {
  const agent = render(
    <ActivityIndicator activity={backgroundActivity([task({ taskType: 'local_agent', description: 'Survey the repo', workflowName: undefined })])} />,
  );
  assert.match(agent.container.textContent ?? '', /Agent Survey the repo/);
  agent.unmount();

  const command = render(
    <ActivityIndicator activity={backgroundActivity([task({ taskType: 'local_bash', description: 'npm test', workflowName: undefined })])} />,
  );
  assert.match(command.container.textContent ?? '', /Command npm test/);
  command.unmount();

  const several = render(
    <ActivityIndicator activity={backgroundActivity([task(), task({ taskId: 'b5xsbzu5k', toolUseId: 'toolu_bash_1', taskType: 'local_bash' })])} />,
  );
  assert.match(several.container.textContent ?? '', /2 tasks/);
});

test('a response in flight still shows the Stop button and the primary dot', () => {
  const { container } = render(
    <ActivityIndicator
      activity={{ statusText: 'Thinking', canInterrupt: true, startedAt: Date.now() }}
      onAbort={() => {}}
    />,
  );

  assert.ok(screen.getByRole('button', { name: 'Stop' }));
  assert.ok(container.querySelector('.bg-primary'));
  assert.equal(container.querySelector('.bg-purple-500'), null);
});
