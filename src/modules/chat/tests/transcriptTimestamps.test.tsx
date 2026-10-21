import assert from 'node:assert/strict';

import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { TranscriptSessionContext } from '@/modules/chat/context/TranscriptSessionContext';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import { SubagentTimeline } from '@/modules/chat/tools/SubagentTimeline';
import { WorkflowPanel } from '@/modules/chat/tools/WorkflowPanel';
import { buildTranscriptExport } from '@/modules/chat/utils/chatExport';
import { groupConsecutiveTools } from '@/modules/chat/utils/toolGrouping';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, DiffLine, LiveTaskStatus, NormalizedMessage, Project, SubagentActivity, ToolGroupItem, WorkflowInfo } from '@/shared/types';
// Type-only, so they are erased before vi.mock's hoisted factories run.
import type * as MarkdownModule from '@/modules/chat/transcript/Markdown';
import type * as ApiModule from '@/shared/api';
import type * as ChatExportModule from '@/modules/chat/utils/chatExport';

/**
 * #1595: with the "Show timestamps" preference on, every transcript row — not
 * only user turns and the first row of an assistant run — carries the time it
 * happened, as do collapsed tool groups, subagent steps and live workflow
 * agents. With it off the transcript is exactly what it was.
 */

/** Counts row re-renders: Markdown is memoised, so this pass-through runs once per render of the row around it. */
const markdownRenders = { count: 0 };
vi.mock('@/modules/chat/transcript/Markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof MarkdownModule>();
  const { createElement } = await import('react');
  return {
    ...actual,
    Markdown: (props: ComponentProps<typeof actual.Markdown>) => {
      markdownRenders.count += 1;
      return createElement(actual.Markdown, props);
    },
  };
});

// The workflow agent-activity route, answered per agent id; and the export
// menu's download, recorded rather than handed to the browser.
const { workflowAgentActivity, downloadTranscriptExport } = vi.hoisted(() => ({
  workflowAgentActivity: vi.fn(),
  downloadTranscriptExport: vi.fn(async () => {}),
}));
vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, workflowAgentActivity } };
});
vi.mock('@/modules/chat/utils/chatExport', async (importOriginal) => ({
  ...(await importOriginal<typeof ChatExportModule>()),
  downloadTranscriptExport,
}));

const createDiff = (): DiffLine[] => [];

/** A local wall-clock time on a day of October 2026, so the assertions read the same in every time zone. */
const at = (day: number, hours: number, minutes: number, seconds: number) =>
  new Date(2026, 9, day, hours, minutes, seconds).toISOString();

const USER_TURN: ChatMessage = { type: 'user', content: 'Tidy the README.', timestamp: at(20, 9, 0, 0) };
const FIRST_REPLY: ChatMessage = { type: 'assistant', content: 'Reading it first.', timestamp: at(20, 9, 0, 4) };
const READ_CALL: ChatMessage = {
  type: 'assistant',
  content: '',
  isToolUse: true,
  toolName: 'Read',
  toolId: 'toolu_read',
  toolInput: JSON.stringify({ file_path: '/repo/README.md' }),
  toolResult: { content: '# repo', isError: false },
  timestamp: at(20, 9, 2, 10),
};
const LATER_REPLY: ChatMessage = { type: 'assistant', content: 'Done.', timestamp: at(20, 14, 32, 5) };
const COMPACTION: ChatMessage = {
  type: 'assistant',
  content: 'Compacted · auto',
  compact: { phase: 'done', trigger: 'auto' },
  timestamp: at(20, 10, 0, 0),
};
const TASK_NOTIFICATION: ChatMessage = {
  type: 'assistant',
  content: 'Agent "Survey" finished',
  isTaskNotification: true,
  taskNotificationStatus: 'completed',
  timestamp: at(20, 10, 5, 0),
};

const PROJECT: Project = { projectId: 'project-1', displayName: 'repo', fullPath: '/repo' } as Project;

/** ICU writes a narrow no-break space before AM/PM and thin spaces around a range's dash; plain spaces keep the expectations readable. */
const plainSpaces = (text: string | null) => (text ?? '').replace(/[\u202f\u00a0\u2009]/g, ' ');
const timeElements = (container: HTMLElement) => [...container.querySelectorAll('time')];
const timeLabels = (container: HTMLElement) => timeElements(container).map((element) => plainSpaces(element.textContent));
/** The left-hand row footer: copy controls, model label and, when it is the only place for it, the time. */
const footers = (container: HTMLElement) => container.querySelectorAll('div.mt-1.w-full');

/** Mocks the browser's own locale and its language list together, as a real browser reports them. */
const mockBrowserLocale = (language: string, languages: string[] = [language]) => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
};

const renderRow = (props: Partial<ComponentProps<typeof MessageComponent>> & { message: ChatMessage }) =>
  render(
    <UiPreferencesProvider>
      <MessageComponent prevMessage={null} createDiff={createDiff} provider="claude" showThinking {...props} />
    </UiPreferencesProvider>,
  );

beforeEach(() => {
  // Only the clock is faked: "today" is what decides whether a date is shown.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 16, 0, 0));
  mockBrowserLocale('en-US', ['en-US', 'en']);
});

afterEach(async () => {
  vi.useRealTimers();
  if (i18n.language !== 'en') {
    await i18n.changeLanguage('en');
  }
});

describe('a transcript row with timestamps off', () => {
  it('keeps the time on user turns and on the first row of a run only, as before', () => {
    const user = renderRow({ message: USER_TURN });
    assert.match(user.container.textContent ?? '', /9:00:00/);
    assert.equal(timeElements(user.container).length, 0, 'the legacy label, not the new element');
    user.unmount();

    const grouped = renderRow({ message: READ_CALL, prevMessage: FIRST_REPLY });
    assert.doesNotMatch(grouped.container.textContent ?? '', /9:02:10/);
    grouped.unmount();

    const compaction = renderRow({ message: COMPACTION, prevMessage: FIRST_REPLY });
    assert.equal(timeElements(compaction.container).length, 0);
  });

  it('keeps the legacy label on a row whose time the backend made up, as before', () => {
    const { container } = renderRow({ message: { ...USER_TURN, timestampEstimated: true } });
    assert.match(container.textContent ?? '', /9:00:00/);
  });
});

describe('a transcript row with timestamps on', () => {
  it('stamps a tool call and a reply that follow another assistant row', () => {
    const tool = renderRow({ message: READ_CALL, prevMessage: FIRST_REPLY, showTimestamps: true });
    assert.deepEqual(timeLabels(tool.container), ['9:02:10 AM']);
    // Beside the call's input line, not on a footer line of its own.
    assert.equal(footers(tool.container).length, 0);
    const [toolTime] = timeElements(tool.container);
    assert.match(toolTime.parentElement?.className ?? '', /\bgrid\b/);
    assert.ok(toolTime.previousElementSibling?.querySelector('button[title="/repo/README.md"]'));
    tool.unmount();

    const reply = renderRow({ message: LATER_REPLY, prevMessage: READ_CALL, showTimestamps: true });
    assert.deepEqual(timeLabels(reply.container), ['2:32:05 PM']);
  });

  it('stamps compaction rows and task notifications, which never had a time', () => {
    const compaction = renderRow({ message: COMPACTION, prevMessage: FIRST_REPLY, showTimestamps: true });
    assert.deepEqual(timeLabels(compaction.container), ['10:00:00 AM']);
    compaction.unmount();

    const notification = renderRow({ message: TASK_NOTIFICATION, prevMessage: FIRST_REPLY, showTimestamps: true });
    assert.deepEqual(timeLabels(notification.container), ['10:05:00 AM']);
  });

  it('keeps one time on a user turn, now as a machine-readable element with the full date in its tooltip', () => {
    const { container } = renderRow({ message: USER_TURN, showTimestamps: true });
    const [time] = timeElements(container);

    assert.equal(timeElements(container).length, 1);
    assert.equal(time.textContent, '9:00:00 AM');
    assert.equal(time.getAttribute('dateTime'), USER_TURN.timestamp);
    assert.match(plainSpaces(time.getAttribute('title')), /Tuesday, October 20, 2026/);
    // Directed by its own text, so a Hebrew month name is not reordered by the row around it.
    assert.equal(time.getAttribute('dir'), 'auto');
  });

  it('stamps an attachment-only user turn too', () => {
    const { container } = renderRow({
      message: { ...USER_TURN, content: '', files: [{ path: '/repo/spec.pdf', name: 'spec.pdf' }] },
      showTimestamps: true,
    });
    assert.deepEqual(timeLabels(container), ['9:00:00 AM']);
  });

  it('keeps an expanded tool output open when the preference flips', () => {
    const bash: ChatMessage = {
      ...READ_CALL,
      toolName: 'Bash',
      toolId: 'toolu_bash',
      toolInput: JSON.stringify({ command: 'ls' }),
      toolResult: { content: 'README.md', isError: false },
    };
    const row = (showTimestamps: boolean) => (
      <UiPreferencesProvider>
        <MessageComponent message={bash} prevMessage={FIRST_REPLY} createDiff={createDiff} provider="claude" showTimestamps={showTimestamps} />
      </UiPreferencesProvider>
    );
    const { container, rerender } = render(row(false));
    const header = () => container.querySelector('[role="button"][aria-expanded]') as HTMLElement;
    fireEvent.click(header());
    assert.equal(header().getAttribute('aria-expanded'), 'true');

    rerender(row(true));
    assert.deepEqual(timeLabels(container), ['9:02:10 AM']);
    assert.equal(header().getAttribute('aria-expanded'), 'true', 'the command row was not remounted');
  });

  it('does not repeat the model label on every tool call of a run', () => {
    const { container } = renderRow({
      message: { ...READ_CALL, model: 'claude-opus-5' },
      prevMessage: FIRST_REPLY,
      showTimestamps: true,
    });
    // Counted rather than compared with null: a failing assert would try to print the whole DOM node.
    assert.equal(container.querySelectorAll('[title="Answered by claude-opus-5"]').length, 0);
  });

  it('adds the date once a row is not from today, and the year once it is not from this year', () => {
    const yesterday = renderRow({ message: { ...LATER_REPLY, timestamp: at(19, 14, 32, 5) }, showTimestamps: true });
    assert.deepEqual(timeLabels(yesterday.container), ['Oct 19, 2:32:05 PM']);
    yesterday.unmount();

    const lastYear = renderRow({
      message: { ...LATER_REPLY, timestamp: new Date(2025, 11, 31, 23, 59, 59).toISOString() },
      showTimestamps: true,
    });
    assert.deepEqual(timeLabels(lastYear.container), ['Dec 31, 2025, 11:59:59 PM']);
  });

  it('accepts the epoch milliseconds and Date objects client-created rows carry', () => {
    const fromNumber = renderRow({
      message: { ...LATER_REPLY, timestamp: new Date(2026, 9, 20, 14, 32, 5).getTime() },
      showTimestamps: true,
    });
    assert.deepEqual(timeLabels(fromNumber.container), ['2:32:05 PM']);
    fromNumber.unmount();

    const fromDate = renderRow({
      message: { ...LATER_REPLY, timestamp: new Date(2026, 9, 20, 14, 32, 5) },
      showTimestamps: true,
    });
    assert.deepEqual(timeLabels(fromDate.container), ['2:32:05 PM']);
  });

  it('shows nothing rather than "Invalid Date" or 1970 for a row without a usable time', () => {
    // 1760000000 is a time in seconds read as milliseconds: a day in January 1970.
    for (const timestamp of ['', 'not a date', 0, 1760000000, '1970-01-01T00:00:00.000Z', undefined]) {
      const { container, unmount } = renderRow({
        message: { ...LATER_REPLY, timestamp: timestamp as ChatMessage['timestamp'] },
        prevMessage: FIRST_REPLY,
        showTimestamps: true,
      });
      assert.equal(timeElements(container).length, 0, `no time for ${String(timestamp)}`);
      assert.doesNotMatch(container.textContent ?? '', /Invalid Date|1970/);
      unmount();
    }
  });

  it('draws no empty footer for a row that has no time to show', () => {
    const thinking: ChatMessage = { type: 'assistant', content: 'Weighing it.', isThinking: true, timestamp: '' };
    const unstamped = renderRow({ message: thinking, prevMessage: FIRST_REPLY, showTimestamps: true });
    assert.equal(footers(unstamped.container).length, 0);
    unstamped.unmount();

    const stamped = renderRow({ message: { ...thinking, timestamp: at(20, 9, 0, 2) }, prevMessage: FIRST_REPLY, showTimestamps: true });
    assert.equal(footers(stamped.container).length, 1);
    assert.deepEqual(timeLabels(stamped.container), ['9:00:02 AM']);
  });

  it('shows no time for a row whose time the backend made up, since the provider recorded none', () => {
    for (const message of [USER_TURN, LATER_REPLY, READ_CALL, COMPACTION]) {
      const { container, unmount } = renderRow({
        message: { ...message, timestampEstimated: true },
        prevMessage: message === USER_TURN ? null : FIRST_REPLY,
        showTimestamps: true,
      });
      assert.equal(timeElements(container).length, 0, `no time on the ${message.isToolUse ? 'tool' : message.type} row`);
      assert.equal(container.querySelectorAll('.grid').length, 0, 'no column laid out for it');
      unmount();
    }
  });

  it('carries the made-up mark from the backend onto the rows it renders', () => {
    const rows = normalizedToChatMessages([
      { id: 'n1', sessionId: 's', provider: 'cursor', kind: 'text', role: 'user', content: 'List the files', timestamp: at(20, 9, 0, 0), timestampEstimated: true },
      { id: 'n2', sessionId: 's', provider: 'cursor', kind: 'tool_use', toolName: 'Shell', toolId: 'c1', toolInput: { command: 'ls' }, timestamp: at(20, 9, 0, 1), timestampEstimated: true },
      { id: 'n3', sessionId: 's', provider: 'claude', kind: 'text', role: 'assistant', content: 'Done.', timestamp: at(20, 9, 0, 2) },
    ] as NormalizedMessage[]);
    assert.deepEqual(rows.map((row) => row.timestampEstimated), [true, true, undefined]);
  });

  it('writes the time the way the app language does, refined by the browser region', async () => {
    mockBrowserLocale('en-GB', ['en-GB', 'en']);
    const british = renderRow({ message: { ...LATER_REPLY, timestamp: at(19, 14, 32, 5) }, showTimestamps: true });
    assert.deepEqual(timeLabels(british.container), ['19 Oct, 14:32:05']);
    british.unmount();

    await act(async () => {
      await i18n.changeLanguage('de');
    });
    mockBrowserLocale('de-DE', ['de-DE', 'de']);
    const german = renderRow({ message: { ...LATER_REPLY, timestamp: at(19, 14, 32, 5) }, showTimestamps: true });
    assert.deepEqual(timeLabels(german.container), ['19. Okt., 14:32:05']);
    german.unmount();

    // A language the app pins to a region keeps that region's own clock.
    await act(async () => {
      await i18n.changeLanguage('pt-BR');
    });
    mockBrowserLocale('en-US', ['en-US', 'en']);
    const brazilian = renderRow({ message: LATER_REPLY, showTimestamps: true });
    assert.deepEqual(timeLabels(brazilian.container), ['14:32:05']);
  });

  it('keeps the browser\'s 24-hour clock while the app language is the default English', () => {
    // A German browser that never picked an app language: the time under its
    // user turns has always read 14:32:05, and switching stamps on keeps it so.
    mockBrowserLocale('de-DE', ['de-DE', 'de', 'en-US', 'en']);
    const { container } = renderRow({ message: LATER_REPLY, showTimestamps: true });
    assert.deepEqual(timeLabels(container), ['14:32:05']);
  });

  it('rewrites a mounted stamp when the app language changes', async () => {
    mockBrowserLocale('en-GB', ['en-GB', 'en']);
    const { container } = renderRow({ message: { ...LATER_REPLY, timestamp: at(19, 14, 32, 5) }, showTimestamps: true });
    assert.deepEqual(timeLabels(container), ['19 Oct, 14:32:05']);

    await act(async () => {
      await i18n.changeLanguage('de');
    });
    assert.deepEqual(timeLabels(container), ['19. Okt., 14:32:05']);
  });
});

describe('a collapsed tool group', () => {
  const GREPS: ChatMessage[] = ['TODO', 'FIXME', 'XXX'].map((pattern, index) => ({
    type: 'assistant',
    content: '',
    isToolUse: true,
    toolName: 'Grep',
    toolId: `toolu_grep_${index}`,
    toolInput: JSON.stringify({ pattern }),
    toolResult: { content: 'No matches', isError: false },
    timestamp: at(20, 8, index, 10),
  }));
  const group = groupConsecutiveTools(GREPS)[0] as ToolGroupItem;

  const renderGroup = (showTimestamps: boolean) =>
    render(
      <UiPreferencesProvider>
        <ToolGroupContainer
          group={group}
          prevMessage={USER_TURN}
          createDiff={createDiff}
          getMessageKey={(message) => String(message.toolId)}
          provider="claude"
          showTimestamps={showTimestamps}
        />
      </UiPreferencesProvider>,
    );

  it('spans its first call to its last, and shows each expanded call its own time', () => {
    const { container } = renderGroup(true);
    assert.deepEqual(timeLabels(container), ['8:00:10 AM – 8:02:10 AM']);
    const [span] = timeElements(container);
    assert.equal(span.getAttribute('dateTime'), GREPS[0].timestamp);
    assert.match(plainSpaces(span.getAttribute('title')), /October 20, 2026, 8:00:10 AM – 8:02:10 AM/);

    fireEvent.click(container.querySelector('button[aria-expanded]') as HTMLButtonElement);
    assert.deepEqual(timeLabels(container), ['8:00:10 AM – 8:02:10 AM', '8:00:10 AM', '8:01:10 AM', '8:02:10 AM']);
  });

  it('shows one time for a run made within the same second, and none for times the backend made up', () => {
    const sameSecond = groupConsecutiveTools(GREPS.map((message) => ({ ...message, timestamp: GREPS[0].timestamp })))[0] as ToolGroupItem;
    const single = render(
      <ToolGroupContainer group={sameSecond} prevMessage={USER_TURN} createDiff={createDiff} getMessageKey={(message) => String(message.toolId)} provider="claude" showTimestamps />,
    );
    assert.deepEqual(timeLabels(single.container), ['8:00:10 AM']);
    single.unmount();

    const madeUp = groupConsecutiveTools(GREPS.map((message) => ({ ...message, timestampEstimated: true })))[0] as ToolGroupItem;
    const none = render(
      <ToolGroupContainer group={madeUp} prevMessage={USER_TURN} createDiff={createDiff} getMessageKey={(message) => String(message.toolId)} provider="claude" showTimestamps />,
    );
    assert.equal(timeElements(none.container).length, 0);
  });

  it('shows no time with the preference off', () => {
    const { container } = renderGroup(false);
    assert.equal(timeElements(container).length, 0);
  });
});

describe('a subagent timeline', () => {
  const STEPS: SubagentActivity[] = [
    { kind: 'text', content: 'Starting the survey.', timestamp: at(20, 8, 3, 30) },
    { kind: 'tool', toolId: 'toolu_child_1', toolName: 'Read', toolInput: { file_path: '/repo/a.txt' }, timestamp: at(20, 8, 3, 31) },
    // A provider may not record a time for a step; that step simply has none.
    { kind: 'thinking', content: 'Nearly done.' },
  ];

  const renderTimeline = (showTimestamps: boolean) =>
    render(<SubagentTimeline activity={STEPS} createDiff={createDiff} showTimestamps={showTimestamps} />);

  it('puts each recorded step time beside its step', () => {
    const { container } = renderTimeline(true);
    assert.deepEqual(timeLabels(container), ['8:03:30 AM', '8:03:31 AM']);
  });

  it('renders the same markup as before with the preference off', () => {
    const off = renderTimeline(false).container.innerHTML;
    const untouched = render(<SubagentTimeline activity={STEPS} createDiff={createDiff} />).container.innerHTML;
    assert.equal(off, untouched);
    assert.doesNotMatch(off, /<time/);
  });

  it('reaches the timeline of an agent card through the transcript row', () => {
    const agentRow: ChatMessage = {
      type: 'assistant',
      content: '',
      isToolUse: true,
      toolName: 'Agent',
      toolId: 'toolu_agent',
      toolInput: JSON.stringify({ subagent_type: 'Explore', description: 'Survey', prompt: 'Look around' }),
      isSubagentContainer: true,
      subagent: { id: 'agent-1', type: 'Explore', status: 'completed' },
      subagentActivity: STEPS,
      timestamp: at(20, 8, 3, 0),
    };
    const { container } = renderRow({ message: agentRow, prevMessage: FIRST_REPLY, showTimestamps: true });
    // In the card's own header: from its launch to its latest recorded step,
    // rather than under the opened card where it would read as an end time.
    const header = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    assert.deepEqual(timeLabels(header), ['8:03:00 AM – 8:03:31 AM']);
    assert.equal(footers(container).length, 0);

    fireEvent.click(header);
    assert.deepEqual(timeLabels(container), ['8:03:00 AM – 8:03:31 AM', '8:03:30 AM', '8:03:31 AM']);
  });
});

describe('a workflow card', () => {
  const WORKFLOW: WorkflowInfo = {
    runId: 'wf_triage-1595',
    name: 'repo-audit',
    status: 'running',
    agents: [{ id: 'a1111aaaa22221595', label: 'audit:docs', phase: 'Audit', status: 'running' }],
    agentCounts: { total: 1, completed: 0, failed: 0, running: 1, stopped: 0 },
  };

  const renderWorkflow = (taskStatus: LiveTaskStatus | undefined, showTimestamps: boolean) =>
    render(
      <WorkflowPanel
        toolInput={{ script: '', description: 'Audit' }}
        workflow={WORKFLOW}
        taskStatus={taskStatus}
        createDiff={createDiff}
        showTimestamps={showTimestamps}
      />,
    );

  const live: LiveTaskStatus = {
    status: 'running',
    agents: [{
      index: 0,
      agentId: 'a1111aaaa22221595',
      label: 'audit:docs',
      state: 'running',
      startedAt: new Date(2026, 9, 20, 8, 9, 1).getTime(),
    }],
  };

  it('shows when a live agent started', () => {
    const { container } = renderWorkflow(live, true);
    fireEvent.click(container.querySelector('button[aria-expanded]') as HTMLButtonElement);
    assert.deepEqual(timeLabels(container), ['8:09:01 AM']);
  });

  it('shows when the workflow was launched in its header', () => {
    const { container } = render(
      <UiPreferencesProvider>
        <MessageComponent
          message={{
            type: 'assistant',
            content: '',
            isToolUse: true,
            toolName: 'Workflow',
            toolId: 'toolu_workflow',
            toolInput: JSON.stringify({ script: '', description: 'Audit' }),
            workflow: WORKFLOW,
            timestamp: at(20, 8, 8, 0),
          }}
          prevMessage={FIRST_REPLY}
          createDiff={createDiff}
          provider="claude"
          showTimestamps
        />
      </UiPreferencesProvider>,
    );
    const header = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    assert.deepEqual(timeLabels(header), ['8:08:00 AM']);
    assert.equal(footers(container).length, 0);
  });

  it('keeps an agent\'s status on the right, with its class as before, when there is no start time to show', () => {
    const statusOf = (container: HTMLElement) => container.querySelector('li span:last-of-type') as HTMLElement;
    const implausible = renderWorkflow({ ...live, agents: [{ ...live.agents![0], startedAt: 0 }] }, true);
    fireEvent.click(implausible.container.querySelector('button[aria-expanded]') as HTMLButtonElement);
    assert.equal(timeElements(implausible.container).length, 0);
    assert.equal(statusOf(implausible.container).className, 'ml-auto flex-shrink-0 text-[11px] text-muted-foreground/70');
    implausible.unmount();

    const off = renderWorkflow(live, false);
    fireEvent.click(off.container.querySelector('button[aria-expanded]') as HTMLButtonElement);
    assert.equal(statusOf(off.container).className, 'ml-auto flex-shrink-0 text-[11px] text-muted-foreground/70');
  });

  it('stamps the steps of an opened agent\'s timeline', async () => {
    workflowAgentActivity.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          agent: { id: 'a1111aaaa22221595', label: 'audit:docs', status: 'completed' },
          activity: [{ kind: 'text', content: 'Reading the docs.', timestamp: at(20, 8, 9, 30) }],
          activityCount: 1,
        },
      }),
    });
    render(
      <TranscriptSessionContext.Provider value={{ sessionId: 'session-1' }}>
        <WorkflowPanel
          toolInput={{ script: '', description: 'Audit' }}
          workflow={{ ...WORKFLOW, status: 'completed', agents: [{ ...WORKFLOW.agents[0], status: 'completed' }] }}
          createDiff={createDiff}
          showTimestamps
        />
      </TranscriptSessionContext.Provider>,
    );
    fireEvent.click(screen.getAllByRole('button', { expanded: false })[0]);
    fireEvent.click(screen.getByRole('button', { name: /audit:docs/ }));

    await waitFor(() => assert.ok(screen.getByText('Reading the docs.')));
    assert.deepEqual(timeLabels(document.body), ['8:09:30 AM']);
  });

  it('shows no agent time when the journal is all there is, or the preference is off', () => {
    const fromJournal = renderWorkflow(undefined, true);
    fireEvent.click(fromJournal.container.querySelector('button[aria-expanded]') as HTMLButtonElement);
    assert.equal(timeElements(fromJournal.container).length, 0);
    fromJournal.unmount();

    const off = renderWorkflow(live, false);
    fireEvent.click(off.container.querySelector('button[aria-expanded]') as HTMLButtonElement);
    assert.equal(timeElements(off.container).length, 0);
  });
});

describe('the transcript pane', () => {
  const TRANSCRIPT = [USER_TURN, FIRST_REPLY, READ_CALL, LATER_REPLY];
  const noop = () => {};
  const grantToolPermission = () => ({ success: true });

  const paneProps = (overrides: Partial<ComponentProps<typeof ChatMessagesPane>>): ComponentProps<typeof ChatMessagesPane> => {
    const messages = overrides.chatMessages ?? TRANSCRIPT;
    return {
      scrollContainerRef: createRef<HTMLDivElement>(),
      onWheel: noop,
      onTouchMove: noop,
      isLoadingSessionMessages: false,
      chatMessages: messages,
      selectedSession: null,
      currentSessionId: 'session-1',
      provider: 'claude',
      setProvider: noop,
      textareaRef: createRef<HTMLTextAreaElement>(),
      providerModels: { claude: '', cursor: '', codex: '', opencode: '' },
      setProviderModel: noop,
      providerModelCatalog: {},
      providerModelActions: { create: async () => {}, update: async () => {}, remove: async () => {} },
      providerModelsLoading: false,
      tasksEnabled: false,
      isTaskMasterInstalled: false,
      setInput: noop,
      isLoadingMoreMessages: false,
      hasMoreMessages: false,
      totalMessages: messages.length,
      sessionMessagesCount: messages.length,
      visibleMessageCount: messages.length,
      visibleMessages: messages,
      loadEarlierMessages: noop,
      revealMessage: noop,
      sendMessage: noop,
      loadAllMessages: noop,
      allMessagesLoaded: true,
      isLoadingAllMessages: false,
      loadAllJustFinished: false,
      showLoadAllOverlay: false,
      createDiff,
      onGrantToolPermission: grantToolPermission,
      selectedProject: PROJECT,
      showThinking: true,
      ...overrides,
    } as ComponentProps<typeof ChatMessagesPane>;
  };

  const renderPane = (overrides: Partial<ComponentProps<typeof ChatMessagesPane>> = {}) => (
    <UiPreferencesProvider>
      <ChatMessagesPane {...paneProps(overrides)} />
    </UiPreferencesProvider>
  );

  it('stamps every row once the preference flips on, without a reload', () => {
    const { container, rerender } = render(renderPane({ showTimestamps: false }));
    assert.equal(timeElements(container).length, 0);

    rerender(renderPane({ showTimestamps: true }));
    assert.deepEqual(timeLabels(container), ['9:00:00 AM', '9:00:04 AM', '9:02:10 AM', '2:32:05 PM']);

    rerender(renderPane({ showTimestamps: false }));
    assert.equal(timeElements(container).length, 0);
  });

  it('hands the preference to the HTML export from the pane\'s export menu', async () => {
    render(renderPane({ showTimestamps: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Export conversation' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Web page/ }));

    await waitFor(() => assert.equal(downloadTranscriptExport.mock.calls.length, 1));
    const [format, input] = downloadTranscriptExport.mock.calls[0] as unknown as [string, { showTimestamps?: boolean }];
    assert.equal(format, 'html');
    assert.equal(input.showTimestamps, true);
  });

  it('still re-renders only the rows a stream tick changed', () => {
    const { rerender } = render(renderPane({ showTimestamps: true }));
    markdownRenders.count = 0;

    // The realtime handler republishes the list as a new array of the same
    // message objects, which gives no mounted row anything new to draw.
    rerender(renderPane({ chatMessages: [...TRANSCRIPT], showTimestamps: true }));
    assert.equal(markdownRenders.count, 0);
  });
});

describe('the HTML export', () => {
  const input = {
    messages: [USER_TURN, FIRST_REPLY, READ_CALL, LATER_REPLY],
    sessionTitle: 'Tidy',
    provider: 'claude' as const,
    createDiff,
  };
  const exportedAt = new Date(2026, 9, 20, 16, 0, 0);

  it('follows the preference, and dates every row since the file outlives the day', async () => {
    const stamped = plainSpaces(await buildTranscriptExport('html', { ...input, showTimestamps: true }, exportedAt));
    assert.equal((stamped.match(/<time /g) ?? []).length, 4);
    assert.match(stamped, />Oct 20, 2:32:05 PM</);

    const plain = await buildTranscriptExport('html', input, exportedAt);
    assert.doesNotMatch(plain, /<time /);
  });

  it('dates no row whose time the backend made up', async () => {
    const madeUp = input.messages.map((message) => ({ ...message, timestampEstimated: true }));
    const html = await buildTranscriptExport('html', { ...input, messages: madeUp, showTimestamps: true }, exportedAt);
    assert.doesNotMatch(html, /<time /);
  });
});
