import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import { BackgroundTasksStrip } from '@/modules/chat/transcript/BackgroundTasksStrip';
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

  it('renders nothing when no task is running', () => {
    const { container } = render(
      <BackgroundTasksStrip
        messages={[
          toolRow({ toolName: 'Read', toolId: 'toolu_read', toolInput: '{}' }),
          toolRow({
            toolName: 'Workflow',
            toolId: 'toolu_workflow_2',
            workflow: { runId: 'wf_1', name: 'review-p1', status: 'completed', agents: [], agentCounts: { total: 0, completed: 0, failed: 0, running: 0 } },
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
              agentCounts: { total: 2, completed: 1, failed: 0, running: 1 },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByRole('button').textContent).toBe('Workflowfrontend-architecture-audit· 1/2');
  });

  it('scrolls to the task\'s card when its chip is clicked', () => {
    const card = document.createElement('div');
    card.id = 'tool-result-toolu_workflow_1';
    card.scrollIntoView = vi.fn();
    document.body.appendChild(card);

    render(
      <BackgroundTasksStrip
        messages={[
          toolRow({
            toolName: 'Workflow',
            toolId: 'toolu_workflow_1',
            taskStatus: { status: 'running', workflowName: 'frontend-architecture-audit' },
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(card.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    card.remove();
  });
});
