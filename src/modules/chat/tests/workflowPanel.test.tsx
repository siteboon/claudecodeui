import { describe, expect, it } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import { WorkflowPanel } from '@/modules/chat/tools/WorkflowPanel';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { LiveTaskStatus, ToolResult, WorkflowInfo } from '@/shared/types';

// The script header the real launch in session 4820c6b8 carried.
const SCRIPT = [
  'export const meta = {',
  "  name: 'frontend-architecture-audit',",
  "  description: 'Evidence-based audit of the frontend',",
  '  phases: [',
  "    { title: 'Audit', detail: 'parallel deep-dives per module cluster' },",
  "    { title: 'Synthesize' },",
  '  ],',
  '}',
  '',
  "const name: 'not-the-workflow'",
].join('\n');

const LAUNCH_ACK: ToolResult = {
  content: 'Workflow launched in background. Task ID: wxkj4kcvd\nSummary: Evidence-based audit of the frontend',
  isError: false,
  toolUseResult: { status: 'async_launched', taskId: 'wxkj4kcvd', taskType: 'local_workflow', runId: 'wf_16fbf852-274' },
};

const completedWorkflow: WorkflowInfo = {
  runId: 'wf_16fbf852-274',
  name: 'frontend-architecture-audit',
  description: 'Evidence-based audit of the frontend',
  status: 'completed',
  agents: [
    { id: 'aa1e064cf8bd159d6', label: 'audit:chat', phase: 'Audit', status: 'completed' },
    { id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', phase: 'Audit', status: 'failed' },
    { id: 'ab89f2cde612a51b1', label: 'synthesize', phase: 'Synthesize', status: 'running' },
  ],
  agentCounts: { total: 3, completed: 1, failed: 1, running: 1, stopped: 0 },
  scriptPath: '/home/user/.claude/projects/p/s/workflows/scripts/frontend-architecture-audit-wf_16fbf852-274.js',
};

const renderPanel = (props: { toolResult?: ToolResult | null; workflow?: WorkflowInfo; taskStatus?: LiveTaskStatus }) =>
  render(
    <WorkflowPanel
      toolInput={JSON.stringify({ script: SCRIPT, description: 'Parallel frontend architecture audit' }, null, 2)}
      toolResult={props.toolResult}
      workflow={props.workflow}
      taskStatus={props.taskStatus}
    />,
  );

describe('a workflow card', () => {
  it('reads as running, named from the script, with only the launch acknowledgement in hand', () => {
    // A live launch: no history load has attached `workflow` yet and no task
    // event has arrived, so everything the card knows is in the tool input.
    renderPanel({ toolResult: LAUNCH_ACK });

    expect(screen.getByText('Workflow')).toBeTruthy();
    expect(screen.getByText('frontend-architecture-audit')).toBeTruthy();
    expect(screen.getByText('Evidence-based audit of the frontend')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    // The acknowledgement is bookkeeping, never a result.
    expect(screen.queryByText(/Workflow launched in background/)).toBeNull();
  });

  it('shows the live phase in place of the plain running word', () => {
    renderPanel({
      toolResult: LAUNCH_ACK,
      taskStatus: { status: 'running', workflowName: 'frontend-architecture-audit', summary: 'Verify 3/6', usage: { totalTokens: 1, toolUses: 12, durationMs: 65_000 } },
    });

    expect(screen.getByText('Verify 3/6')).toBeTruthy();
    expect(screen.queryByText('running')).toBeNull();

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('12 tool uses · 1m 5s')).toBeTruthy();
  });

  it('shows a call the tool refused as failed, with the refusal', () => {
    // Real shape (session 4820c6b8, toolu_013kMvJMNEzFoDJrzW8vWZHE): the
    // script did not parse, so nothing was launched and no journal, no
    // notification and no task event will ever arrive to settle the card.
    renderPanel({
      toolResult: {
        content: '<tool_use_error>Invalid workflow script: Script parse error: Unexpected token (152:27)</tool_use_error>',
        isError: true,
        toolUseResult: 'Error: Invalid workflow script: Script parse error: Unexpected token (152:27)',
      },
    });

    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.queryByText('running')).toBeNull();
    expect(document.querySelector('.animate-pulse')).toBeNull();

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/Invalid workflow script/)).toBeTruthy();
  });

  it('keeps the plain running word when the live summary only restates the description', () => {
    // The SDK's first progress events carry the workflow's description as
    // their summary; the header already says that.
    renderPanel({
      toolResult: LAUNCH_ACK,
      taskStatus: { status: 'running', workflowName: 'frontend-architecture-audit', summary: 'Evidence-based audit of the frontend' },
    });

    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getAllByText('Evidence-based audit of the frontend')).toHaveLength(1);
  });

  it('draws a completed run: check mark, agents, phases and the pretty-printed result', () => {
    renderPanel({
      toolResult: { content: '{"audits":[{"area":"src/modules/chat"}]}', isError: false },
      workflow: completedWorkflow,
    });

    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.queryByText('running')).toBeNull();

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByText('2 of 3 agents finished · 1 failed')).toBeTruthy();
    expect(screen.getByText('audit:chat')).toBeTruthy();
    expect(screen.getByText('audit:sidebar')).toBeTruthy();
    expect(screen.getByText('synthesize')).toBeTruthy();
    expect(screen.getByText('Audit')).toBeTruthy();
    expect(screen.getByText('— parallel deep-dives per module cluster')).toBeTruthy();
    expect(screen.getByText('Synthesize')).toBeTruthy();

    // JSON reads as a document, not one line: the code block is indented.
    const code = document.querySelector('code');
    expect(code?.textContent).toContain('"audits": [');
    expect(code?.textContent).toContain('"area": "src/modules/chat"');

    // The script is there but folded away.
    const scriptDetails = screen.getByText('Script').closest('details');
    expect(scriptDetails?.open).toBe(false);
    expect(scriptDetails?.textContent).toContain('export const meta');
  });

  it('shows a run whose process ended before it reported as having no result', () => {
    renderPanel({
      toolResult: { content: '', isError: false },
      workflow: { ...completedWorkflow, status: 'stopped', agents: [], agentCounts: { total: 0, completed: 0, failed: 0, running: 0, stopped: 0 } },
    });

    expect(screen.getByText('no result')).toBeTruthy();
    expect(screen.getByTitle('The run ended before this workflow reported back')).toBeTruthy();
    expect(screen.queryByText('running')).toBeNull();
    expect(screen.queryByText('done')).toBeNull();
  });

  it('lets a live completion settle the card before history reloads', () => {
    // The notification landed on the stream; the last history load still says
    // running. The live word is the fresher one.
    renderPanel({
      toolResult: LAUNCH_ACK,
      workflow: { ...completedWorkflow, status: 'running' },
      taskStatus: { status: 'completed', summary: 'Dynamic workflow completed' },
    });

    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.queryByText('running')).toBeNull();
  });

  it('keeps a stopped run stopped when a stale live event still says running', () => {
    // The backend judged the launch orphaned — a later run is up — while the
    // store still holds a `task_progress` from the run that died.
    renderPanel({
      toolResult: { content: '', isError: false },
      workflow: { ...completedWorkflow, status: 'stopped' },
      taskStatus: { status: 'running', summary: 'Verify 3/6' },
    });

    expect(screen.getByText('no result')).toBeTruthy();
    expect(screen.queryByText('Verify 3/6')).toBeNull();
  });
});

describe('a Workflow tool call in the transcript', () => {
  it('is drawn as a workflow card, anchored for the background-tasks strip', () => {
    // Before this the call went through the generic tool renderer: a row named
    // after the tool with the launch acknowledgement as its result, forever.
    const { container } = render(
      <UiPreferencesProvider>
        <MessageComponent
          message={{
            type: 'assistant',
            content: '',
            timestamp: '2026-08-21T10:32:10.000Z',
            isToolUse: true,
            toolName: 'Workflow',
            toolId: 'toolu_workflow_1',
            toolInput: JSON.stringify({ script: SCRIPT, description: 'Parallel frontend architecture audit' }, null, 2),
            toolResult: LAUNCH_ACK,
            taskStatus: { status: 'running', workflowName: 'frontend-architecture-audit', summary: 'Verify 3/6' },
          }}
          prevMessage={null}
          createDiff={() => []}
          provider="claude"
        />
      </UiPreferencesProvider>,
    );

    const card = container.querySelector('#tool-result-toolu_workflow_1');
    expect(card?.textContent).toContain('Workflow');
    expect(card?.textContent).toContain('frontend-architecture-audit');
    expect(card?.textContent).toContain('Verify 3/6');
    expect(container.textContent).not.toContain('Workflow launched in background');
  });
});
