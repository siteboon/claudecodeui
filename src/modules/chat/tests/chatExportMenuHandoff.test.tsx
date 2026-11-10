import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, it, vi } from 'vitest';
import type * as ReactI18nextModule from 'react-i18next';

import ChatExportMenu from '@/modules/chat/transcript/ChatExportMenu';
import type { ChatMessage, Project } from '@/shared/types';

/** "Continue in new chat" replaces only its own untouched digest and never drops other draft text. */

const drafts = new Map<string, string>();

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/shared/chatDrafts', () => ({
  readDraftText: (scope: string) => drafts.get(scope) ?? '',
  writeDraftText: (scope: string, text: string) => { drafts.set(scope, text); },
}));

// The menu remembers its last digest per project for the page's life, so each test takes its own project.
let projectIndex = 0;
let project: Project;
let scope: string;
const turns = (text: string): ChatMessage[] => [
  { id: 'm1', type: 'user', content: text, timestamp: '2026-10-26T10:00:00.000Z' },
];

const handoff = async (sessionId: string | undefined, text: string) => {
  const onNewSession = vi.fn();
  const view = render(
    <ChatExportMenu
      messages={turns(text)}
      sessionTitle="Same title"
      sessionId={sessionId}
      provider="claude"
      selectedProject={project}
      createDiff={() => []}
      onNewSession={onNewSession}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'export.trigger' }));
  await act(async () => { fireEvent.click(screen.getByText('export.handoff.label')); });
  await waitFor(() => assert.equal(onNewSession.mock.calls.length, 1));
  view.unmount();
};

const count = (needle: string) => (drafts.get(scope) ?? '').split(needle).length - 1;

beforeEach(() => {
  drafts.clear();
  projectIndex += 1;
  project = { projectId: `p${projectIndex}` } as Project;
  scope = `project:${project.projectId}`;
});

describe('ChatExportMenu continue in new chat', () => {
  it('replaces an untouched digest of the same session on a repeat click', async () => {
    drafts.set(scope, 'typed before');
    await handoff('s1', 'first state');
    await handoff('s1', 'second state');

    const draft = drafts.get(scope) ?? '';
    assert.ok(draft.startsWith('typed before\n\n'));
    assert.equal(count('I am continuing'), 1);
    assert.ok(draft.includes('second state') && !draft.includes('first state'));
  });

  it('keeps text typed after the digest and digests of other sessions with the same title', async () => {
    await handoff('s1', 'session one');
    drafts.set(scope, `${drafts.get(scope)}\n\nmy note`);
    await handoff('s1', 'session one again');
    await handoff('s2', 'session two');

    const draft = drafts.get(scope) ?? '';
    assert.ok(draft.includes('my note'));
    assert.ok(draft.includes('session one\n\nmy note'), 'the edited digest stays');
    assert.ok(draft.includes('session one again'));
    assert.ok(draft.includes('session two'));
    assert.equal(count('I am continuing'), 3);
  });

  it('opens no new chat from a partial transcript when the full one fails to load', async () => {
    const onNewSession = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ChatExportMenu
        messages={turns('cached tail')}
        sessionId="s1"
        provider="claude"
        selectedProject={project}
        createDiff={() => []}
        onLoadFullTranscript={() => Promise.reject(new Error('offline'))}
        onNewSession={onNewSession}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'export.trigger' }));
    await act(async () => { fireEvent.click(screen.getByText('export.handoff.label')); });
    fireEvent.click(screen.getByRole('button', { name: 'export.trigger' }));

    await waitFor(() => assert.ok(screen.getByText('export.failed')));
    assert.equal(onNewSession.mock.calls.length, 0);
    assert.equal(drafts.has(scope), false);
  });

  it('stays put when another chat opens while the transcript loads', async () => {
    const onNewSession = vi.fn();
    let finish: (messages: ChatMessage[]) => void = () => {};
    const props = {
      messages: turns('first chat'),
      provider: 'claude',
      selectedProject: project,
      createDiff: () => [],
      onLoadFullTranscript: () => new Promise<ChatMessage[]>((resolve) => { finish = resolve; }),
      onNewSession,
    };
    const view = render(<ChatExportMenu {...props} sessionId="s1" />);
    fireEvent.click(screen.getByRole('button', { name: 'export.trigger' }));
    await act(async () => { fireEvent.click(screen.getByText('export.handoff.label')); });

    view.rerender(<ChatExportMenu {...props} sessionId="s2" />);
    await act(async () => { finish(turns('first chat')); });

    assert.equal(onNewSession.mock.calls.length, 0);
    assert.equal(drafts.has(scope), false);
  });

  it('shows a failed file export on its item, only in the chat it failed in', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const props = {
      messages: turns('cached tail'),
      provider: 'claude',
      selectedProject: project,
      createDiff: () => [],
      onLoadFullTranscript: () => Promise.reject(new Error('offline')),
    };
    const view = render(<ChatExportMenu {...props} sessionId="s1" />);
    fireEvent.click(screen.getByRole('button', { name: 'export.trigger' }));
    await act(async () => { fireEvent.click(screen.getByText('export.markdown.label')); });
    fireEvent.click(screen.getByRole('button', { name: 'export.trigger' }));

    await waitFor(() => assert.ok(screen.getByText('export.failed')));
    assert.ok(screen.getByText('export.html.description'), 'the other formats keep their description');

    view.rerender(<ChatExportMenu {...props} sessionId="s2" />);
    assert.equal(screen.queryByText('export.failed'), null, 'another chat does not inherit the failure');
  });

  for (const [name, leave] of [
    ['the menu unmounts', (view: ReturnType<typeof render>) => view.unmount()],
    ['another project opens', (view: ReturnType<typeof render>, props: ComponentProps<typeof ChatExportMenu>) => {
      view.rerender(<ChatExportMenu {...props} selectedProject={{ projectId: 'other' } as Project} />);
    }],
  ] as const) {
    it(`stays put when ${name} while the transcript loads`, async () => {
      const onNewSession = vi.fn();
      let finish: (messages: ChatMessage[]) => void = () => {};
      // No session id on either side, so only the project or the unmount tells the chats apart.
      const props = {
        messages: turns('first chat'),
        provider: 'claude',
        selectedProject: project,
        createDiff: () => [],
        onLoadFullTranscript: () => new Promise<ChatMessage[]>((resolve) => { finish = resolve; }),
        onNewSession,
      };
      const view = render(<ChatExportMenu {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'export.trigger' }));
      await act(async () => { fireEvent.click(screen.getByText('export.handoff.label')); });

      leave(view, props);
      await act(async () => { finish(turns('first chat')); });

      assert.equal(onNewSession.mock.calls.length, 0);
      assert.equal(drafts.has(scope), false);
    });
  }

  it('never replaces a digest when the session has no id yet', async () => {
    await handoff(undefined, 'chat one');
    await handoff(undefined, 'chat two');

    assert.equal(count('I am continuing'), 2);
  });
});
