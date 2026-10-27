import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

import '@/modules/i18n';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type {
  BackgroundTaskSummary,
  ServerEvent,
  SessionBackgroundWork,
  SessionHeartbeat,
  SessionSubagent,
  SubagentTimelinePage,
} from '@/shared/types';

// The two background-work routes, answered from what each test queues: the
// list route always with `listed`, the timeline route with the next page.
const { routes, sessionBackgroundWork, subagentTimeline } = vi.hoisted(() => {
  const routes = {
    listed: null as SessionBackgroundWork | null,
    pages: [] as SubagentTimelinePage[],
    cursors: [] as Array<string | undefined>,
  };
  const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
  const sessionBackgroundWork = vi.fn(async () => ok(routes.listed));
  const subagentTimeline = vi.fn(async (_sessionId: string, _agentId: string, cursor?: string) => {
    routes.cursors.push(cursor);
    const page = routes.pages.length > 1 ? routes.pages.shift() : routes.pages[0];
    return ok(page);
  });
  return { routes, sessionBackgroundWork, subagentTimeline };
});
vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { sessionBackgroundWork, subagentTimeline },
}));

const { default: AgentsPanel } = await import('@/modules/chat/agentsPanel/AgentsPanel');
const { useAgentsPanel } = await import('@/modules/chat/hooks/useAgentsPanel');

const agent = (fields: Partial<SessionSubagent> & Pick<SessionSubagent, 'agentId' | 'status'>): SessionSubagent => ({
  description: `Agent ${fields.agentId}`,
  background: true,
  depth: 1,
  activityCount: 3,
  resumeCount: 0,
  stoppable: fields.status === 'running',
  ...fields,
});

const heartbeat = (fields: Partial<SessionHeartbeat> & Pick<SessionHeartbeat, 'id'>): SessionHeartbeat => ({
  schedule: '7,37 * * * *',
  prompt: 'Heartbeat: check the exam jobs',
  recurring: true,
  fireCount: 0,
  ...fields,
});

const WORK: SessionBackgroundWork = {
  processLive: true,
  heartbeats: [heartbeat({ id: 'hb-one', fireCount: 3, lastFiredAt: '2026-10-27T13:37:05.000Z', nextFireAt: Date.parse('2026-10-27T14:07:05.000Z') })],
  subagents: [
    agent({ agentId: 'a-run', status: 'running', description: 'L: encoder diagnosis', lastActivity: 'Bash · Run the diagnosis', agentType: 'Explore', activityCount: 42 }),
    agent({ agentId: 'a-done', status: 'completed', description: 'K: epoch panels', lastActivity: 'SubagentHandback · Package K is done.', lastActivityAt: '2026-10-27T12:51:18.000Z' }),
    agent({ agentId: 'a-stopped', status: 'stopped', description: 'J: OABC arms' }),
  ],
};

const renderPanel = (props: Partial<React.ComponentProps<typeof AgentsPanel>> = {}) => {
  const handlers = {
    onSelectAgent: vi.fn(),
    onStopAgent: vi.fn(),
    onStopHeartbeat: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <UiPreferencesProvider>
      <AgentsPanel sessionId="session-1" work={WORK} error={null} selectedAgentId={null} createDiff={() => []} {...handlers} {...props} />
    </UiPreferencesProvider>,
  );
  return handlers;
};

const timelinePage = (fields: Partial<SubagentTimelinePage>): SubagentTimelinePage => ({
  agent: WORK.subagents[0],
  cursor: 'g1.1',
  reset: true,
  entries: [],
  activityCount: 0,
  ...fields,
});

afterEach(() => {
  vi.useRealTimers();
  routes.listed = null;
  routes.pages = [];
  routes.cursors = [];
});

describe('the agents panel list', () => {
  it('shows heartbeats, then running agents with a Stop, then finished ones', () => {
    const handlers = renderPanel();

    expect(screen.getByText('1 running · you can keep chatting')).toBeTruthy();
    expect(screen.getByText('Heartbeats')).toBeTruthy();
    expect(screen.getByText('7,37 * * * *')).toBeTruthy();
    expect(screen.getByText(/fired 3 times/)).toBeTruthy();
    expect(screen.getByText('Running · 1')).toBeTruthy();
    expect(screen.getByText('Finished · 2')).toBeTruthy();
    expect(screen.getByText('Bash · Run the diagnosis')).toBeTruthy();
    expect(screen.getByText('Explore')).toBeTruthy();

    // One Stop: only the running agent's process can stop it.
    const stops = screen.getAllByRole('button', { name: 'Stop this agent' });
    expect(stops).toHaveLength(1);
    fireEvent.click(stops[0]);
    expect(handlers.onStopAgent).toHaveBeenCalledWith('a-run');

    fireEvent.click(screen.getByText('K: epoch panels'));
    expect(handlers.onSelectAgent).toHaveBeenCalledWith('a-done');

    fireEvent.click(screen.getByRole('button', { name: 'Stop…' }));
    expect(handlers.onStopHeartbeat).toHaveBeenCalledWith(WORK.heartbeats[0]);
  });

  it('says heartbeats wait while Claude is not running, and when two share a schedule', () => {
    renderPanel({
      work: {
        processLive: false,
        subagents: [],
        heartbeats: [heartbeat({ id: 'hb-one' }), heartbeat({ id: 'hb-two', prompt: 'A leftover heartbeat' })],
      },
    });

    expect(screen.getAllByText('waiting')).toHaveLength(2);
    expect(screen.getByText(/they fire only while it runs/)).toBeTruthy();
    expect(screen.getByText('More than one heartbeat runs on 7,37 * * * *. One may be left over.')).toBeTruthy();
    expect(screen.getByText('Nothing running')).toBeTruthy();
  });

  it('says so when the chat has nothing on the side', () => {
    renderPanel({ work: { processLive: false, subagents: [], heartbeats: [] } });
    expect(screen.getByText(/No subagents or heartbeats in this chat yet/)).toBeTruthy();
  });
});

describe('an agent opened in the panel', () => {
  it('follows a running agent: the newest steps, then only what changed, until it is done', async () => {
    vi.useFakeTimers();
    routes.pages = [
      timelinePage({
        prompt: 'Diagnose the encoder.',
        cursor: 'g1.2',
        activityCount: 2,
        entries: [
          { index: 0, kind: 'text', content: 'Starting the diagnosis.' },
          { index: 1, kind: 'tool', toolId: 'toolu_1', toolName: 'Bash', toolInput: { command: 'python diag.py' } },
        ],
      }),
      timelinePage({
        cursor: 'g1.4',
        reset: false,
        activityCount: 3,
        agent: { ...WORK.subagents[0], status: 'completed', stoppable: false, summary: 'Agent "L" completed' },
        entries: [
          { index: 1, kind: 'tool', toolId: 'toolu_1', toolName: 'Bash', toolInput: { command: 'python diag.py' }, toolResult: { content: 'ok', isError: false } },
          { index: 2, kind: 'text', content: 'The encoder is fine.' },
        ],
      }),
    ];
    const handlers = renderPanel({ selectedAgentId: 'a-run' });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(screen.getByText('Starting the diagnosis.')).toBeTruthy();
    expect(screen.getByText('Diagnose the encoder.')).toBeTruthy();
    expect(screen.getByText('Working · you can keep chatting')).toBeTruthy();
    expect(routes.cursors).toEqual([undefined]);

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(routes.cursors).toEqual([undefined, 'g1.2']);
    expect(screen.getByText('Starting the diagnosis.')).toBeTruthy();
    expect(screen.getByText('The encoder is fine.')).toBeTruthy();
    expect(screen.getByText('Agent "L" completed')).toBeTruthy();

    // Done: no more reads. (The list still says running; its next read would
    // settle it there too.)
    const reads = subagentTimeline.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(subagentTimeline.mock.calls.length).toBe(reads);

    fireEvent.click(screen.getAllByRole('button', { name: 'Back to all agents' })[0]);
    expect(handlers.onSelectAgent).toHaveBeenCalledWith(null);
  });
});

describe('useAgentsPanel', () => {
  const subscribers = new Set<(event: ServerEvent) => void>();
  const subscribe = (listener: (event: ServerEvent) => void) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  };
  const runningAgent: BackgroundTaskSummary = { taskId: 'a-run', toolUseId: 'toolu_run', taskType: 'local_agent', description: 'L', startedAt: 1 };

  afterEach(() => {
    subscribers.clear();
  });

  it('opens by itself when an agent starts on a wide screen, and not again once closed', async () => {
    vi.useFakeTimers();
    routes.listed = WORK;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const { result, rerender } = renderHook(
      ({ tasks }: { tasks: BackgroundTaskSummary[] }) => useAgentsPanel({ sessionId: 'session-1', enabled: true, runningTasks: tasks, subscribe }),
      { initialProps: { tasks: [] as BackgroundTaskSummary[] } },
    );
    expect(result.current.isOpen).toBe(false);
    expect(sessionBackgroundWork).not.toHaveBeenCalled();

    rerender({ tasks: [runningAgent] });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.work).toEqual(WORK);
    expect(result.current.runningAgentCount).toBe(1);

    // Something runs, so the open panel re-reads on a short cycle.
    const reads = sessionBackgroundWork.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(sessionBackgroundWork.mock.calls.length).toBe(reads + 1);

    // A task event for this chat re-reads soon after; one for another chat does not.
    act(() => {
      for (const listener of subscribers) {
        listener({ kind: 'task_status', sessionId: 'other-session' });
        listener({ kind: 'task_status', sessionId: 'session-1' });
      }
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(sessionBackgroundWork.mock.calls.length).toBe(reads + 2);

    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
    rerender({ tasks: [runningAgent, { ...runningAgent, taskId: 'a-two', toolUseId: 'toolu_two' }] });
    expect(result.current.isOpen).toBe(false);

    // Opening it again by hand is always possible.
    act(() => result.current.open('a-run'));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.selectedAgentId).toBe('a-run');
  });

  it('stays closed on a narrow screen, where it would cover the chat', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const { result } = renderHook(() => useAgentsPanel({ sessionId: 'session-1', enabled: true, runningTasks: [runningAgent], subscribe }));
    expect(result.current.isOpen).toBe(false);
  });

  it('does not read for a chat whose provider keeps no background work', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentsPanel({ sessionId: 'session-1', enabled: false, runningTasks: [runningAgent], subscribe }));
    act(() => result.current.open());
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(sessionBackgroundWork).not.toHaveBeenCalled();
  });
});
