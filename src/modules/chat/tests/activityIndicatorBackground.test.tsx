import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, test, vi } from 'vitest';

import '@/modules/i18n';
import ActivityIndicator from '@/modules/chat/composer/ActivityIndicator';
import type { BackgroundTaskSummary, SessionActivity } from '@/shared/types';

/**
 * The pill above the composer used to vanish at the turn's `complete` even
 * when the CLI stayed open for the agents, workflows or commands the turn
 * launched. A background-only entry now keeps it up, named for the work and
 * in the purple of the workflow and agent cards. Nothing is responding and the
 * composer can send, so it offers no Stop for a turn — but it does offer to
 * stop the work, which otherwise had no control besides one chip per task.
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

afterEach(() => {
  vi.useRealTimers();
});

test('a background-only session names its workflow, counts from its start and offers no Stop for a turn', () => {
  const onAbort = vi.fn();
  const { container } = render(<ActivityIndicator activity={backgroundActivity([task()])} onAbort={onAbort} />);

  assert.match(container.textContent ?? '', /Background work…/);
  assert.match(container.textContent ?? '', /Workflow frontend-architecture-audit/);
  assert.match(container.textContent ?? '', /1m 5s/, 'elapsed since the task started, not since the pill mounted');
  assert.equal(screen.queryByRole('button', { name: 'Stop' }), null);
  assert.ok(container.querySelector('.bg-purple-500'), 'the dot is the cards\' purple, not the primary colour');
});

test('a background-only session offers to stop all of its background work', () => {
  const onStopBackground = vi.fn();
  render(<ActivityIndicator activity={backgroundActivity([task()])} onStopBackground={onStopBackground} />);

  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));

  assert.equal(onStopBackground.mock.calls.length, 1);
});

test('Stop all asks once: a second click before the work settles sends nothing', () => {
  // The first stop ends the work, so a second would find nothing to stop and
  // come back as an error in the conversation.
  const onStopBackground = vi.fn();
  render(<ActivityIndicator activity={backgroundActivity([task()])} onStopBackground={onStopBackground} />);

  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));

  assert.equal(onStopBackground.mock.calls.length, 1);
});

test('Stop all stays disabled while the tasks it stopped report back one by one', () => {
  // Each `stopped` notification republishes the pill with the tasks left, and
  // the last one takes it down through the exit animation: every step is a new
  // activity, and a press during any of them would still find nothing to stop.
  const onStopBackground = vi.fn();
  const first = task({ taskId: 'a1', toolUseId: 'toolu_agent_1', taskType: 'local_agent', workflowName: undefined });
  const second = task({ taskId: 'a2', toolUseId: 'toolu_agent_2', taskType: 'local_agent', workflowName: undefined });
  const view = render(<ActivityIndicator activity={backgroundActivity([first, second])} onStopBackground={onStopBackground} />);

  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
  view.rerender(<ActivityIndicator activity={backgroundActivity([second])} onStopBackground={onStopBackground} />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
  view.rerender(<ActivityIndicator activity={null} onStopBackground={onStopBackground} />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));

  assert.equal(onStopBackground.mock.calls.length, 1);
});

test('Stop all is offered again for work started after the press', () => {
  // Even while a task the press stopped is still listed next to it: the new
  // work has not been asked to stop.
  const onStopBackground = vi.fn();
  const view = render(<ActivityIndicator activity={backgroundActivity([task()])} onStopBackground={onStopBackground} />);

  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
  view.rerender(
    <ActivityIndicator
      activity={backgroundActivity([
        task(),
        task({ taskId: 'a3', toolUseId: 'toolu_agent_3', taskType: 'local_agent', workflowName: undefined }),
      ])}
      onStopBackground={onStopBackground}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));

  assert.equal(onStopBackground.mock.calls.length, 2);
});

test('Stop all stays disabled while a workflow it stopped still lists its own command', () => {
  // The workflow agent's backgrounded command is the agent's business, not new
  // work of the session's, so it does not bring the button back.
  const onStopBackground = vi.fn();
  const listed = () => [task(), task({ taskId: 'b5xsbzu5k', toolUseId: 'toolu_bash_1', taskType: 'local_bash', nested: true })];
  const view = render(<ActivityIndicator activity={backgroundActivity(listed())} onStopBackground={onStopBackground} />);

  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
  view.rerender(<ActivityIndicator activity={backgroundActivity(listed())} onStopBackground={onStopBackground} />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));

  assert.equal(onStopBackground.mock.calls.length, 1);
});

test('Stop all can be pressed again once a press has changed nothing for 10 s', () => {
  // A press can be lost (the socket was not open, or the server's stop
  // failed), and then the same tasks stay listed. A press that took effect
  // clears the pill long before: the stops report back within a second, and
  // the 5 s running-sessions poll drops work the server no longer tracks.
  vi.useFakeTimers();
  const onStopBackground = vi.fn();
  const listed = () => [
    task({ taskId: 'a1', toolUseId: 'toolu_agent_1', taskType: 'local_agent', workflowName: undefined }),
    task({ taskId: 'a2', toolUseId: 'toolu_agent_2', taskType: 'local_agent', workflowName: undefined }),
  ];
  const view = render(<ActivityIndicator activity={backgroundActivity(listed())} onStopBackground={onStopBackground} />);

  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
  act(() => { vi.advanceTimersByTime(6_000); });
  // The poll hands in an equal copy of the same work.
  view.rerender(<ActivityIndicator activity={backgroundActivity(listed())} onStopBackground={onStopBackground} />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
  assert.equal(onStopBackground.mock.calls.length, 1, 'still disabled past the first poll');

  act(() => { vi.advanceTimersByTime(4_000); });
  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));

  assert.equal(onStopBackground.mock.calls.length, 2);
});

test('a response in flight offers its Stop, not Stop all, even with tasks running', () => {
  render(
    <ActivityIndicator
      activity={{ statusText: 'Thinking', canInterrupt: true, startedAt: Date.now(), tasks: [task()] }}
      onAbort={() => {}}
      onStopBackground={() => {}}
    />,
  );

  assert.ok(screen.getByRole('button', { name: 'Stop' }));
  // Compared as a boolean: a failing assertion on the element itself would
  // serialize the whole jsdom node into the report.
  assert.equal(screen.queryByRole('button', { name: 'Stop all' }) === null, true, 'no Stop all while a response is in flight');
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
  several.unmount();

  // A workflow agent's own backgrounded command is listed (it can be stopped)
  // but it is the agent's business, not a second task of the session's.
  const nested = render(
    <ActivityIndicator activity={backgroundActivity([task(), task({ taskId: 'b5xsbzu5k', toolUseId: 'toolu_bash_1', taskType: 'local_bash', nested: true })])} />,
  );
  assert.match(nested.container.textContent ?? '', /Workflow frontend-architecture-audit/);
  assert.doesNotMatch(nested.container.textContent ?? '', /2 tasks/);
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
