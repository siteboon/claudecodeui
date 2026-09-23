import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import { TranscriptRenderContext } from '@/modules/chat/context/TranscriptRenderContext';
import { TranscriptSessionContext } from '@/modules/chat/context/TranscriptSessionContext';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { LiveTaskStatus, SubagentActivity, ToolResult, WorkflowAgentProgress, WorkflowInfo } from '@/shared/types';

// What the agent-activity route answers with, keyed by agent id; a missing
// key answers the way the server does for an agent that left no transcript.
const { agentActivityByAgentId, workflowAgentActivity } = vi.hoisted(() => {
  const agentActivityByAgentId = new Map<string, { agent: { id: string; label?: string; status: string }; prompt?: string; result?: string; activity: SubagentActivity[]; activityCount: number }>();
  const workflowAgentActivity = vi.fn(async (_sessionId: string, _runId: string, agentId: string) => {
    const payload = agentActivityByAgentId.get(agentId);
    return payload
      ? { ok: true, status: 200, json: async () => ({ success: true, data: payload }) }
      : { ok: false, status: 404, json: async () => ({ success: false, error: { code: 'WORKFLOW_AGENT_NOT_FOUND', message: `Workflow agent "${agentId}" was not found.` } }) };
  });
  return { agentActivityByAgentId, workflowAgentActivity };
});
// Only the endpoint is stubbed; `readApiJson` stays real so a 404 turns into
// the same error the card sees in the app.
vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { workflowAgentActivity },
}));

const { WorkflowPanel } = await import('@/modules/chat/tools/WorkflowPanel');

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

const renderPanel = (
  props: { toolResult?: ToolResult | null; workflow?: WorkflowInfo; taskStatus?: LiveTaskStatus },
  // The session the transcript belongs to, as ChatInterface provides it; a
  // bare render has none, like an exported document.
  sessionId: string | null = null,
) =>
  render(
    <TranscriptSessionContext.Provider value={{ sessionId }}>
      <WorkflowPanel
        toolInput={JSON.stringify({ script: SCRIPT, description: 'Parallel frontend architecture audit' }, null, 2)}
        toolResult={props.toolResult}
        workflow={props.workflow}
        taskStatus={props.taskStatus}
        createDiff={() => []}
      />
    </TranscriptSessionContext.Provider>,
  );

/** Opens the card. */
const openCard = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

/** The rows of the card's agent list, as text. */
const agentRows = () => [...(screen.getByText('Agents').parentElement?.parentElement?.querySelectorAll('li') ?? [])];

/** The stream's word on the three agents partway through the run: one done, one working, one queued. */
const liveAgents: WorkflowAgentProgress[] = [
  { index: 0, label: 'audit:chat', agentId: 'aa1e064cf8bd159d6', state: 'done', startedAt: 1_700_000_000_000, tokens: 8_000, toolCalls: 20, resultPreview: 'Three large hooks carry most of the module.' },
  { index: 1, label: 'audit:sidebar', agentId: 'a9cfe29aa8f2afcbf', state: 'running', startedAt: 1_700_000_120_000, lastToolName: 'Grep', lastToolSummary: 'useSidebar', tokens: 4_000, toolCalls: 12 },
  { index: 2, state: 'queued', promptPreview: 'You are the synthesis step of a code-quality audit.\nMerge the audits.' },
];

afterEach(() => {
  agentActivityByAgentId.clear();
  workflowAgentActivity.mockClear();
  vi.useRealTimers();
});

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

describe('the agents of a workflow card', () => {
  it('lists what each agent is doing, from the live stream over the journal, while the run is going', () => {
    // The journal (last history load) still has audit:chat running and knows
    // nothing of the queued slot; the stream is fresher on both.
    renderPanel({
      toolResult: LAUNCH_ACK,
      workflow: {
        ...completedWorkflow,
        status: 'running',
        agents: [
          { id: 'aa1e064cf8bd159d6', label: 'audit:chat', phase: 'Audit', status: 'running' },
          { id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', phase: 'Audit', status: 'running' },
        ],
      },
      taskStatus: { status: 'running', agents: liveAgents, usage: { totalTokens: 12_345, toolUses: 32, durationMs: 210_000 } },
    });
    openCard();

    expect(agentRows().map((row) => row.textContent)).toEqual([
      'audit:chat· AuditdoneThree large hooks carry most of the module.',
      'audit:sidebar· AuditrunningGrep: useSidebar4k tokens12 tool calls',
      // Not yet started: named from its prompt, since it has no id or label.
      'You are the synthesis step of a code-quality audit.queued',
    ]);
    expect(screen.getByText('1 of 3 agents finished')).toBeTruthy();
    // Where the run is, not "· audit:sidebar" as if it were a tool name.
    expect(screen.getByText('32 tool uses · 3m 30s · current: audit:sidebar')).toBeTruthy();
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(2);
  });

  it('names the current agent from the task description when the stream has not listed agents yet', () => {
    // The first progress events of a run carry the current agent's label in
    // their description and no agent list.
    renderPanel({
      toolResult: LAUNCH_ACK,
      taskStatus: { status: 'running', description: 'audit:chat', usage: { totalTokens: 1, toolUses: 2, durationMs: 5_000 } },
    });
    openCard();

    expect(screen.getByText('2 tool uses · 5s · current: audit:chat')).toBeTruthy();
  });

  it('lets the journal settle the agents once the run is over, whatever the stream last said', () => {
    // The stream's last word had audit:sidebar running and a slot queued; the
    // journal knows audit:sidebar failed. Its own unsettled `running` for
    // synthesize is stale: the run is over, so that agent has no result.
    renderPanel({
      toolResult: { content: '{"audits":[]}', isError: false },
      workflow: completedWorkflow,
      taskStatus: { status: 'completed', agents: liveAgents, usage: { totalTokens: 1, toolUses: 40, durationMs: 300_000 } },
    });
    openCard();

    const rows = agentRows();
    expect(rows.map((row) => row.textContent)).toEqual([
      'audit:chat· AuditdoneThree large hooks carry most of the module.',
      'audit:sidebar· Auditfailed',
      'synthesize· Synthesizeno result',
    ]);
    expect(rows[1]?.querySelector('.text-red-600')?.textContent).toBe('audit:sidebar');
    expect(screen.getByText('2 of 3 agents finished · 1 failed')).toBeTruthy();
    expect(screen.getByText('40 tool uses · 5m 0s')).toBeTruthy();
  });

  it('lets a live completion settle an agent the stale journal still has running', () => {
    // The run finished, the stream said so for its one agent, and history has
    // not been re-read yet: the journal's `running` is the older word.
    renderPanel({
      toolResult: { content: '{"audits":[]}', isError: false },
      workflow: {
        ...completedWorkflow,
        status: 'running',
        agents: [{ id: 'aa1e064cf8bd159d6', label: 'audit:chat', phase: 'Audit', status: 'running' }],
        agentCounts: { total: 1, completed: 0, failed: 0, running: 1, stopped: 0 },
      },
      taskStatus: { status: 'completed', agents: [liveAgents[0]] },
    });
    openCard();

    expect(agentRows().map((row) => row.textContent)).toEqual([
      'audit:chat· AuditdoneThree large hooks carry most of the module.',
    ]);
    expect(screen.getByText('1 of 1 agent finished')).toBeTruthy();
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });

  it('shows an agent\'s phase from the stream when the journal has none for it', () => {
    // The stream names the phase on every entry; a journal row read before
    // the agent's phase was written has no word on it.
    renderPanel({
      toolResult: LAUNCH_ACK,
      workflow: {
        ...completedWorkflow,
        status: 'running',
        agents: [{ id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', status: 'running' }],
        agentCounts: { total: 1, completed: 0, failed: 0, running: 1, stopped: 0 },
      },
      taskStatus: { status: 'running', agents: [{ ...liveAgents[1], phase: 'Audit' }] },
    });
    openCard();

    expect(agentRows().map((row) => row.textContent)).toEqual([
      'audit:sidebar· AuditrunningGrep: useSidebar4k tokens12 tool calls',
    ]);
  });

  it('counts one tool call and one agent in the singular', () => {
    renderPanel({
      toolResult: LAUNCH_ACK,
      taskStatus: { status: 'running', agents: [{ ...liveAgents[1], toolCalls: 1 }] },
    });
    openCard();

    expect(screen.getByText('1 tool call')).toBeTruthy();
    expect(screen.getByText('0 of 1 agent finished')).toBeTruthy();
  });

  it('names no current agent once the stream has listed agents and none of them is running', () => {
    // Between agents the task's description is the last one's label, not a
    // step still going.
    renderPanel({
      toolResult: LAUNCH_ACK,
      taskStatus: {
        status: 'running',
        description: 'Audit: audit:chat',
        agents: [liveAgents[0], { index: 1, state: 'queued' }],
        usage: { totalTokens: 1, toolUses: 20, durationMs: 60_000 },
      },
    });
    openCard();

    expect(screen.getByText('20 tool uses · 1m 0s')).toBeTruthy();
    expect(screen.queryByText(/current:/)).toBeNull();
  });

  it('keeps re-reading a running agent\'s timeline through a failed read, and keeps the last one it got', async () => {
    // The CLI reports an agent's start a moment before its transcript exists,
    // so the first read of a fresh agent can be a 404; a later read can fail
    // on a blip. Neither is the end of the agent.
    vi.useFakeTimers();
    renderPanel({ toolResult: LAUNCH_ACK, taskStatus: { status: 'running', agents: liveAgents } }, 'session-1');
    openCard();
    fireEvent.click(screen.getByRole('button', { name: /audit:sidebar/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Steps unavailable: Workflow agent "a9cfe29aa8f2afcbf" was not found.')).toBeTruthy();

    // The transcript appears: the next read finds it.
    agentActivityByAgentId.set('a9cfe29aa8f2afcbf', {
      agent: { id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', status: 'running' },
      activity: [{ kind: 'thinking', content: 'Two hooks to compare.' }],
      activityCount: 1,
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Two hooks to compare.')).toBeTruthy();

    // A blip on the read after that changes nothing on screen, and the
    // polling goes on.
    agentActivityByAgentId.delete('a9cfe29aa8f2afcbf');
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Two hooks to compare.')).toBeTruthy();
    expect(screen.queryByText(/Steps unavailable/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(4);
  });

  it('opens an agent\'s timeline from its transcript and stops re-reading it once the agent is done', async () => {
    vi.useFakeTimers();
    agentActivityByAgentId.set('a9cfe29aa8f2afcbf', {
      agent: { id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', status: 'running' },
      activity: [
        { kind: 'thinking', content: 'Two hooks to compare.' },
        { kind: 'tool', toolId: 'toolu_wa_1', toolName: 'Grep', toolInput: { pattern: 'useSidebar' }, toolResult: { content: 'src/modules/sidebar/useSidebar.ts', isError: false } },
      ],
      activityCount: 27,
    });
    const running: LiveTaskStatus = { status: 'running', agents: liveAgents };
    const { rerender } = render(
      <TranscriptSessionContext.Provider value={{ sessionId: 'session-1' }}>
        <WorkflowPanel toolInput="{}" toolResult={LAUNCH_ACK} taskStatus={running} createDiff={() => []} />
      </TranscriptSessionContext.Provider>,
    );
    openCard();

    // Nothing is fetched until a row is opened.
    expect(workflowAgentActivity).not.toHaveBeenCalled();
    const sidebarRow = screen.getByRole('button', { name: /audit:sidebar/ });
    expect(sidebarRow.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(sidebarRow);
    expect(sidebarRow.getAttribute('aria-expanded')).toBe('true');
    // Addressed by the session the transcript belongs to and the run id the
    // launch acknowledgement carries — never a path.
    expect(workflowAgentActivity).toHaveBeenCalledWith('session-1', 'wf_16fbf852-274', 'a9cfe29aa8f2afcbf');

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Two hooks to compare.')).toBeTruthy();
    expect(screen.getByText('useSidebar')).toBeTruthy();
    // The backend capped the timeline; the card says so like an agent card.
    expect(screen.getByText('25 earlier steps are not included')).toBeTruthy();

    // Re-read every three seconds while the agent runs…
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(3);

    // …once more when the card hears it is done — by when, outside auto mode,
    // the journal has its result — and then no more.
    agentActivityByAgentId.set('a9cfe29aa8f2afcbf', {
      agent: { id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', status: 'completed' },
      result: 'One hook owns the sidebar.',
      activity: [{ kind: 'thinking', content: 'Two hooks to compare.' }],
      activityCount: 27,
    });
    rerender(
      <TranscriptSessionContext.Provider value={{ sessionId: 'session-1' }}>
        <WorkflowPanel
          toolInput="{}"
          toolResult={LAUNCH_ACK}
          taskStatus={{ status: 'running', agents: liveAgents.map((agent) => (agent.index === 1 ? { ...agent, state: 'done' as const } : agent)) }}
          createDiff={() => []}
        />
      </TranscriptSessionContext.Provider>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(4);
    expect(screen.getByText('One hook owns the sidebar.')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(4);
  });

  it('keeps re-reading an agent the card has heard is done until the journal has its result', async () => {
    // The CLI reports an agent done before it appends the result to the
    // journal — in auto mode only after a classifier request — so the read
    // the card's change triggers can find the server still calling it
    // running. Stopping there would leave the row without its result.
    vi.useFakeTimers();
    const sidebarActivity = [{ kind: 'thinking' as const, content: 'Two hooks to compare.' }];
    agentActivityByAgentId.set('a9cfe29aa8f2afcbf', {
      agent: { id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', status: 'running' },
      activity: sidebarActivity,
      activityCount: 1,
    });
    const renderWithSidebar = (state: WorkflowAgentProgress['state']) => (
      <TranscriptSessionContext.Provider value={{ sessionId: 'session-1' }}>
        <WorkflowPanel
          toolInput="{}"
          toolResult={LAUNCH_ACK}
          taskStatus={{ status: 'running', agents: liveAgents.map((agent) => (agent.index === 1 ? { ...agent, state } : agent)) }}
          createDiff={() => []}
        />
      </TranscriptSessionContext.Provider>
    );
    const { rerender } = render(renderWithSidebar('running'));
    openCard();
    fireEvent.click(screen.getByRole('button', { name: /audit:sidebar/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(1);

    // The card hears the agent is done; the journal has nothing for it yet.
    rerender(renderWithSidebar('done'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('Result')).toBeNull();

    // The journal catches up: the next read carries the result, and is the last.
    agentActivityByAgentId.set('a9cfe29aa8f2afcbf', {
      agent: { id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', status: 'completed' },
      result: 'FULL AGENT RESULT TEXT',
      activity: sidebarActivity,
      activityCount: 1,
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(4);
    expect(screen.getByText('FULL AGENT RESULT TEXT')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(4);
  });

  it('shows an opened agent\'s task and its whole result around its steps', async () => {
    // What the CLI's `/workflows` view shows per agent. The row alone offers
    // at most a two-line preview from the live stream, which a reload loses.
    const prompt = [
      'You are the chat step of a frontend audit.',
      'Read src/modules/chat and report its largest hooks.',
      'Return { area, hooks }.',
    ].join('\n');
    agentActivityByAgentId.set('aa1e064cf8bd159d6', {
      agent: { id: 'aa1e064cf8bd159d6', label: 'audit:chat', status: 'completed' },
      prompt,
      result: '{"area":"chat","hooks":["useChatMessages","useChatComposerState"]}',
      activity: [{ kind: 'text', content: 'Three large hooks carry most of the module.' }],
      activityCount: 1,
    });
    renderPanel({ toolResult: { content: '{"audits":[]}', isError: false }, workflow: completedWorkflow }, 'session-1');
    openCard();

    fireEvent.click(screen.getByRole('button', { name: /audit:chat/ }));
    await waitFor(() => expect(screen.getByText('Three large hooks carry most of the module.')).toBeTruthy());

    expect(screen.getByText('Task')).toBeTruthy();
    expect(screen.getByText(/You are the chat step of a frontend audit\./).textContent).toBe(prompt);
    // The agent's own result, next to the run's, pretty-printed like it.
    expect(screen.getAllByText('Result')).toHaveLength(2);
    const agentResult = [...document.querySelectorAll('code')].find((code) => code.textContent?.includes('"area": "chat"'));
    expect(agentResult?.textContent).toContain('"hooks": [');
  });

  it('shows no task or result for an agent whose transcript has neither', async () => {
    agentActivityByAgentId.set('a9cfe29aa8f2afcbf', {
      agent: { id: 'a9cfe29aa8f2afcbf', label: 'audit:sidebar', status: 'failed' },
      activity: [{ kind: 'thinking', content: 'Two hooks to compare.' }],
      activityCount: 1,
    });
    renderPanel({ toolResult: { content: '', isError: false }, workflow: { ...completedWorkflow, status: 'failed' } }, 'session-1');
    openCard();

    fireEvent.click(screen.getByRole('button', { name: /audit:sidebar/ }));
    await waitFor(() => expect(screen.getByText('Two hooks to compare.')).toBeTruthy());
    expect(screen.queryByText('Task')).toBeNull();
    expect(screen.queryByText('Result')).toBeNull();
  });

  it('exports a finished agent\'s whole result preview, since nothing in the file can open the row', () => {
    const markup = renderToStaticMarkup(
      <TranscriptRenderContext.Provider value={{ isExporting: true }}>
        <WorkflowPanel
          toolInput="{}"
          toolResult={LAUNCH_ACK}
          taskStatus={{ status: 'running', agents: liveAgents }}
          createDiff={() => []}
        />
      </TranscriptRenderContext.Provider>,
    );

    expect(markup).toContain('Three large hooks carry most of the module.');
    expect(markup).not.toContain('line-clamp');
  });

  it('says so in one line when an agent left no transcript, and does not keep asking for a done one', async () => {
    vi.useFakeTimers();
    renderPanel({ toolResult: LAUNCH_ACK, taskStatus: { status: 'running', agents: liveAgents } }, 'session-1');
    openCard();

    fireEvent.click(screen.getByRole('button', { name: /audit:chat/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Steps unavailable: Workflow agent "aa1e064cf8bd159d6" was not found.')).toBeTruthy();
    // No read ever said it was running, and the card has it done.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(workflowAgentActivity).toHaveBeenCalledTimes(1);
  });

  it('cannot open an agent outside a session, where there is nothing to fetch from', () => {
    renderPanel({ toolResult: LAUNCH_ACK, taskStatus: { status: 'running', agents: liveAgents } });
    openCard();

    expect(screen.queryByRole('button', { name: /audit:chat/ })).toBeNull();
    expect(screen.getByText('audit:chat')).toBeTruthy();
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
