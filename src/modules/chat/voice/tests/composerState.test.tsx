import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import { authoredCount, isDraftArmed, resetAuthoredPrompts } from '@/modules/chat/voice/authoredPrompts';
import { currentDictationScope } from '@/modules/chat/voice/dictation';
import { installAudioFakes } from '@/modules/chat/voice/tests/kit';
import { readDraftText, resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

vi.mock('@/shared/api', () => {
  const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
  return {
    api: {
      user: {
        drafts: () => okJson({ success: true, drafts: [] }),
        saveDraft: () => okJson({ success: true }),
        deleteDraft: () => okJson({ success: true }),
        preferences: () => okJson({ success: true, preferences: {} }),
        savePreferences: () => okJson({ success: true, preferences: {} }),
      },
      commands: { list: () => okJson({ success: true, commands: [] }) },
      files: { search: () => okJson({ success: true, files: [] }) },
      voice: { health: () => okJson({ configured: true }) },
    },
    authenticatedFetch: () => okJson({}),
    synthesizeVoice: () => okJson({}),
    transcribeVoice: () => okJson({ text: '' }),
    voiceConfigSignature: () => '',
  };
});

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };

function renderComposer(session: ProjectSession | null, options: { isLoading?: boolean; sendMessage?: (m: unknown) => void } = {}) {
  return renderHook(
    ({ current, isLoading }: { current: ProjectSession | null; isLoading: boolean }) => useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: current,
      currentSessionId: current?.id ?? null,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: options.sendMessage ?? (() => undefined),
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
    { initialProps: { current: session, isLoading: options.isLoading ?? false } },
  );
}

const submitEvent = () => ({ preventDefault: () => undefined }) as unknown as Parameters<ReturnType<typeof useChatComposerState>['handleSubmit']>[0];

beforeEach(() => {
  localStorage.clear();
  resetChatDrafts();
  resetAuthoredPrompts();
  installAudioFakes();
});

describe('transcript placement (U8)', () => {
  test('a transcript appends to the end and never overwrites typed text', async () => {
    const view = renderComposer({ id: 'session-a' });
    await act(async () => view.result.current.setInput('Napsaný začátek'));
    await act(async () => view.result.current.handleVoiceTranscript('a nadiktovaný konec', false, currentDictationScope()));
    expect(view.result.current.input).toBe('Napsaný začátek a nadiktovaný konec');
  });

  test('recording started in A, builder switches to B before the transcript returns: text lands in A, B unchanged', async () => {
    const sendMessage = vi.fn();
    const view = renderComposer({ id: 'session-a' }, { sendMessage });
    const origin = currentDictationScope(); // what the recorder snapshots at start
    expect(origin).toBe('session-a');

    await act(async () => view.rerender({ current: { id: 'session-b' }, isLoading: false }));
    await act(async () => view.result.current.setInput('rozepsané v B'));
    await act(async () => view.result.current.handleVoiceTranscript('diktát pro A', true, origin));

    expect(readDraftText('session-a')).toBe('diktát pro A');
    expect(view.result.current.input).toBe('rozepsané v B');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('Send and authorship (U7)', () => {
  test('Send stops playback before the prompt goes out, and counts the prompt as this page\'s', async () => {
    const order: string[] = [];
    const stop = vi.spyOn(voicePlayer, 'stop').mockImplementation(() => {
      order.push('stop');
    });
    const view = renderComposer({ id: 'session-a' }, { sendMessage: () => order.push('send') });
    await act(async () => view.result.current.setInput('Udělej to'));
    await act(async () => view.result.current.handleSubmit(submitEvent()));
    expect(stop).toHaveBeenCalled();
    expect(order.indexOf('stop')).toBeLessThan(order.indexOf('send'));
    expect(authoredCount('session-a')).toBe(1);
  });

  test('a draft queued during a running turn is armed as this page\'s; editing it back or deleting it disarms it', async () => {
    const view = renderComposer({ id: 'session-a' }, { isLoading: true });
    await act(async () => view.result.current.setInput('Další krok'));
    await act(async () => view.result.current.handleSubmit(submitEvent()));
    expect(view.result.current.queuedDraft?.content).toBe('Další krok');
    expect(isDraftArmed('session-a')).toBe(true);
    expect(authoredCount('session-a')).toBe(0); // counted only when its own run starts

    await act(async () => view.result.current.editQueuedDraft());
    expect(isDraftArmed('session-a')).toBe(false);

    await act(async () => view.result.current.handleSubmit(submitEvent()));
    expect(isDraftArmed('session-a')).toBe(true);
    await act(async () => view.result.current.deleteQueuedDraft());
    expect(isDraftArmed('session-a')).toBe(false);
  });
});
