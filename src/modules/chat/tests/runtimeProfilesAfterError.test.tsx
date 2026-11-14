import assert from 'node:assert/strict';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { test, vi } from 'vitest';

import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/chat/transcript/ProviderSelectionEmptyState', () => ({
  default: ({ onRetryRuntimeProfiles }: { onRetryRuntimeProfiles?: () => void }) => (
    <button onClick={onRetryRuntimeProfiles}>Retry CLI environments</button>
  ),
}));
vi.mock('@/modules/chat/transcript/MessageComponent', () => ({ default: () => <p>Pre-session error</p> }));
vi.mock('@/modules/chat/transcript/ChatExportMenu', () => ({ default: () => null }));
vi.mock('@/modules/chat/transcript/BackgroundTasksStrip', () => ({ BackgroundTasksStrip: () => null }));
vi.mock('@/modules/chat/transcript/LoadAllMessagesOverlay', () => ({ default: () => null }));

test('pre-session errors retain runtime profile controls and retry alongside the transcript', () => {
  const retry = vi.fn();
  const noop = () => {};
  const message = { id: 'pre-session-error', type: 'error', role: 'error', content: 'No session yet' };
  const props = {
    scrollContainerRef: { current: null }, textareaRef: { current: null },
    onWheel: noop, onTouchMove: noop, isLoadingSessionMessages: false,
    chatMessages: [message], visibleMessages: [message], selectedSession: null, currentSessionId: null,
    provider: 'codex', setProvider: noop, runtimeProfiles: [], runtimeProfilesError: 'offline',
    onRetryRuntimeProfiles: retry, selectedRuntimeProfileId: 'default', onSelectRuntimeProfile: noop,
    providerModels: { claude: '', codex: '', cursor: '', opencode: '' }, setProviderModel: noop,
    providerModelCatalog: {}, providerModelActions: { create: noop, update: noop, remove: noop, setCustomModelsOnly: noop },
    providerModelsLoading: false, tasksEnabled: false, isTaskMasterInstalled: null, setInput: noop,
    isLoadingMoreMessages: false, hasMoreMessages: false, totalMessages: 1, sessionMessagesCount: 1,
    visibleMessageCount: 1, loadEarlierMessages: noop, revealMessage: noop, sendMessage: noop,
    loadAllMessages: noop, allMessagesLoaded: true, isLoadingAllMessages: false,
    loadAllJustFinished: false, showLoadAllOverlay: false, createDiff: noop,
    onGrantToolPermission: () => ({ success: true }), selectedProject: { name: 'Test', path: '/tmp/test' },
  } as unknown as ComponentProps<typeof ChatMessagesPane>;
  render(<ChatMessagesPane {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry CLI environments' }));
  assert.equal(retry.mock.calls.length, 1);
  assert.ok(screen.getByText('Pre-session error'));
});
