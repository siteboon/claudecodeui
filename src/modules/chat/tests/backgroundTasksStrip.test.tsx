import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import { BackgroundTasksStrip } from '@/modules/chat/transcript/BackgroundTasksStrip';
import { visibleCountToReveal } from '@/modules/chat/hooks/useChatSessionState';
import { SESSION_MESSAGES_PAGE_SIZE } from '@/modules/chat/utils/sessionMessagePagination';
import type { ChatMessage } from '@/shared/types';

const toolRow = (overrides: Partial<ChatMessage>): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: '2026-08-21T10:32:10.000Z',
  isToolUse: true,
  ...overrides,
});

describe('the background tasks strip', () => {
  it('lists a running workflow and a running agent with what each has got to', () => {
    render(
      <BackgroundTasksStrip
        sessionId="session-1"
        sendMessage={() => {}}
        onReveal={() => {}}
        messages={[
          toolRow({ toolName: 'Read', toolId: 'toolu_read', toolInput: '{}' }),
          toolRow({
            toolName: 'Workflow',
            toolId: 'toolu_workflow_1',
            taskStatus: { status: 'running', workflowName: 'frontend-architecture-audit', summary: 'Verify 3/6' },
          }),
          toolRow({
            toolName: 'Agent',
            toolId: 'toolu_agent_1',
            isSubagentContainer: true,
            taskStatus: { status: 'running', description: 'Survey the repo', usage: { totalTokens: 1, toolUses: 12, durationMs: 1 } },
          }),
          // Finished: the live notification has landed.
          toolRow({
            toolName: 'Workflow',
            toolId: 'toolu_workflow_2',
            taskStatus: { status: 'completed', workflowName: 'review-p1' },
          }),
        ]}
      />,
    );

    const chips = screen.getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Workflowfrontend-architecture-audit· Verify 3/6',
      'AgentSurvey the repo· 12 tools',
    ]);
  });

  it('says how many of a workflow\'s agents have finished and which one it is on', () => {
    // Once the stream reports on the run's agents, that beats its summary —
    // which only restates the workflow's description.
    render(
      <BackgroundTasksStrip
        onReveal={() => {}}
        sessionId="session-1"
        sendMessage={() => {}}
        messages={[
          toolRow({
            toolName: 'Workflow',
            toolId: 'toolu_workflow_1',
            taskStatus: {
              status: 'running',
              workflowName: 'frontend-architecture-audit',
              summary: 'Evidence-based audit of the frontend',
              agents: [
                { index: 0, label: 'audit:chat', agentId: 'aa1e064cf8bd159d6', state: 'done', startedAt: 1 },
                { index: 1, label: 'audit:sidebar', agentId: 'a9cfe29aa8f2afcbf', state: 'running', startedAt: 2 },
                { index: 2, label: 'audit:files', agentId: 'ab89f2cde612a51b1', state: 'failed', startedAt: 3 },
                { index: 3, label: 'synthesize', state: 'queued' },
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByRole('button').textContent).toBe('Workflowfrontend-architecture-audit· 2/4 agents · audit:sidebar');
  });

  it('renders nothing when no task is running', () => {
    const { container } = render(
      <BackgroundTasksStrip
        sessionId="session-1"
        sendMessage={() => {}}
        onReveal={() => {}}
        messages={[
          toolRow({ toolName: 'Read', toolId: 'toolu_read', toolInput: '{}' }),
          toolRow({
            toolName: 'Workflow',
            toolId: 'toolu_workflow_2',
            workflow: { runId: 'wf_1', name: 'review-p1', status: 'completed', agents: [], agentCounts: { total: 0, completed: 0, failed: 0, running: 0, stopped: 0 } },
          }),
        ]}
      />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('keeps a workflow the last history load left running, before any live event', () => {
    // A page reloaded mid-run: the store has no task events yet, but the
    // backend read the journal and knows the run is still going.
    render(
      <BackgroundTasksStrip
        sessionId="session-1"
        sendMessage={() => {}}
        onReveal={() => {}}
        messages={[
          toolRow({
            toolName: 'Workflow',
            toolId: 'toolu_workflow_1',
            workflow: {
              runId: 'wf_1',
              name: 'frontend-architecture-audit',
              status: 'running',
              agents: [
                { id: 'a1', status: 'completed' },
                { id: 'a2', status: 'running' },
              ],
              agentCounts: { total: 2, completed: 1, failed: 0, running: 1, stopped: 0 },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByRole('button').textContent).toBe('Workflowfrontend-architecture-audit· 1/2');
  });

  it('asks the pane to reveal the task\'s row when its chip is clicked', () => {
    // The row may be outside the visible window or in an unmounted lazy row,
    // so the strip cannot reach it with an element lookup of its own; the
    // pane's session state widens the window and scrolls the row's wrapper.
    const onReveal = vi.fn();
    const row = toolRow({
      toolName: 'Workflow',
      toolId: 'toolu_workflow_1',
      taskStatus: { status: 'running', workflowName: 'frontend-architecture-audit' },
    });

    render(<BackgroundTasksStrip sessionId="session-1" sendMessage={() => {}} onReveal={onReveal} messages={[row]} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onReveal).toHaveBeenCalledWith(row);
  });

  it('clips a long progress summary inside the chip and keeps the whole text in the title', () => {
    // The progress span was `flex-shrink-0`: a summary of a few dozen words
    // ran out of the chip's background and across the transcript.
    const summary = 'Phase 2 of 6: three agents in sequence review the composer, the transcript and the sidebar for overflow';
    render(
      <BackgroundTasksStrip
        sessionId="session-1"
        sendMessage={() => {}}
        onReveal={() => {}}
        messages={[toolRow({
          toolName: 'Workflow',
          toolId: 'toolu_workflow_1',
          toolInput: JSON.stringify({ description: 'Audit the frontend', script: '' }),
          taskStatus: { status: 'running', workflowName: 'frontend-architecture-audit', summary },
        })]}
      />,
    );

    const chip = screen.getByRole('button');
    const progress = chip.lastElementChild as HTMLElement;
    expect(progress.textContent).toBe(`· ${summary}`);
    expect(progress.className).toContain('truncate');
    expect(progress.className).toContain('min-w-0');
    expect(progress.className).not.toContain('flex-shrink-0');
    expect(chip.title).toBe(`Workflow · frontend-architecture-audit · ${summary}`);
    expect(chip.parentElement?.className).toContain('max-w-full');
  });

  it('does not repeat the launch\'s description as progress', () => {
    // A workflow's first progress report carries its own description as the
    // summary, which the card already shows in its header and the chip in
    // its name; as progress it is only noise, and long.
    render(
      <BackgroundTasksStrip
        sessionId="session-1"
        sendMessage={() => {}}
        onReveal={() => {}}
        messages={[
          toolRow({
            toolName: 'Workflow',
            toolId: 'toolu_workflow_1',
            toolInput: JSON.stringify({ description: 'Evidence-based audit of the frontend', script: '' }),
            taskStatus: { status: 'running', workflowName: 'audit', summary: 'Evidence-based audit of the frontend' },
          }),
          toolRow({
            toolName: 'Agent',
            toolId: 'toolu_agent_1',
            isSubagentContainer: true,
            taskStatus: { status: 'running', description: 'Survey the repo', summary: 'Survey the repo' },
          }),
        ]}
      />,
    );

    expect(screen.getAllByRole('button').map((chip) => chip.textContent)).toEqual([
      'Workflowaudit',
      'AgentSurvey the repo',
    ]);
  });

  it('stops a task over the websocket from its chip, by the id its events or acknowledgement named', () => {
    const sendMessage = vi.fn();
    render(
      <BackgroundTasksStrip
        sessionId="session-1"
        sendMessage={sendMessage}
        onReveal={() => {}}
        messages={[
          // Named by the live start event.
          toolRow({
            toolName: 'Workflow',
            toolId: 'toolu_workflow_1',
            taskStatus: { status: 'running', taskId: 'wxkj4kcvd', workflowName: 'audit' },
          }),
          // Named only by the launch acknowledgement: the page loaded after
          // the start event went by.
          toolRow({
            toolName: 'Agent',
            toolId: 'toolu_agent_1',
            subagent: { id: 'a1', description: 'Survey the repo', status: 'running' },
            toolResult: { content: '', isError: false, toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1', taskId: 'agent-task-1' } },
          }),
          // A backgrounded command's acknowledgement spells it differently.
          toolRow({
            toolName: 'Bash',
            toolId: 'toolu_bash_1',
            taskStatus: { status: 'running', description: 'npm test' },
            toolResult: { content: '', isError: false, toolUseResult: { backgroundTaskId: 'b5xsbzu5k' } },
          }),
          // Nothing has named this one, so nothing can stop it.
          toolRow({
            toolName: 'Agent',
            toolId: 'toolu_agent_2',
            subagent: { id: 'a2', description: 'Unnamed', status: 'running' },
          }),
        ]}
      />,
    );

    const stops = screen.getAllByRole('button', { name: 'Stop' });
    expect(stops).toHaveLength(3);
    stops.forEach((stop) => fireEvent.click(stop));

    expect(sendMessage.mock.calls.map(([frame]) => frame)).toEqual([
      { type: 'chat.stop-task', sessionId: 'session-1', taskId: 'wxkj4kcvd' },
      { type: 'chat.stop-task', sessionId: 'session-1', taskId: 'agent-task-1' },
      { type: 'chat.stop-task', sessionId: 'session-1', taskId: 'b5xsbzu5k' },
    ]);
  });
});

describe('visibleCountToReveal', () => {
  it('keeps the window when the row is already inside it', () => {
    // 942 rows, window of 100: row 900 has 42 rows after it, itself included.
    expect(visibleCountToReveal(942, 900, 100)).toBe(100);
  });

  it('widens the window to the row plus a page of context when it is not', () => {
    // Row 106 of 942 needs 836 rows shown; a page more gives it some context above.
    expect(visibleCountToReveal(942, 106, 100)).toBe(836 + SESSION_MESSAGES_PAGE_SIZE);
  });
});
