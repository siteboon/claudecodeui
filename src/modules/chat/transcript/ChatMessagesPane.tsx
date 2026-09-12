import { useTranslation } from 'react-i18next';
import { memo, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from 'react';

import { cn } from '@/shared/utils';

import type { ChatMessage,
  Project,
  ProjectSession,
  LLMProvider,
  ProviderModelActions,
  ProviderModelsDefinition } from '@/shared/types';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';
import { groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';
import type { MessageListItem } from '@/modules/chat/utils/toolGrouping';
import { buildPromptEntries } from '@/modules/chat/utils/promptNavigator';
import type { PromptEntry } from '@/modules/chat/utils/promptNavigator';
import { useLazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import { useActivePromptEntry } from '@/modules/chat/hooks/useActivePromptEntry';
import { useElementWidth } from '@/modules/chat/hooks/useElementWidth';
import { useTranscriptVirtualization } from '@/modules/chat/hooks/useTranscriptVirtualization';
import LazyMessageRow from '@/modules/chat/transcript/LazyMessageRow';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import ProviderSelectionEmptyState from '@/modules/chat/transcript/ProviderSelectionEmptyState';
import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import LoadAllMessagesOverlay from '@/modules/chat/transcript/LoadAllMessagesOverlay';
import ChatExportMenu from '@/modules/chat/transcript/ChatExportMenu';
import { PromptNavigatorRail } from '@/modules/chat/transcript/PromptNavigatorRail';

/**
 * How many of the newest rows mount with real content on the first commit,
 * before the lazy-row observer has had a chance to report what is actually
 * near the viewport. Covers a bit more than one screen of typical rows.
 */
const INITIAL_MOUNTED_TAIL_ROWS = 30;

type ChatMessagesPaneProps = {
  scrollContainerRef: RefObject<HTMLDivElement>;
  onWheel: () => void;
  onTouchMove: () => void;
  isLoadingSessionMessages: boolean;
  /** True while the viewed session has an active provider run in flight. */
  isProcessing?: boolean;
  /** True while ChatComposer's floating activity/stop tab is rendered above the input. */
  hasActivityIndicator?: boolean;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  setProvider: (provider: LLMProvider) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  providerModels: Record<LLMProvider, string>;
  setProviderModel: (provider: LLMProvider, model: string) => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelActions: ProviderModelActions;
  providerModelsLoading: boolean;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: Dispatch<SetStateAction<string>>;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  sessionMessagesCount: number;
  loadAllMessages: () => void;
  allMessagesLoaded: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  showLoadAllOverlay: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  /** Loads an already-sent message back into the composer; absent when the provider cannot re-run from a point. */
  onEditMessage?: (message: ChatMessage) => void;
  /** Branches the conversation into a new session ending at a message. */
  onForkFromMessage?: (message: ChatMessage) => void;
  /** Fetches the whole transcript for an export, which otherwise only sees the loaded page. */
  onLoadFullTranscript?: () => Promise<ChatMessage[]>;
  /** Jumps the transcript to a prompt chosen on the navigator rail. */
  onSelectPrompt?: (entry: PromptEntry) => void;
  /** Fetches the previous page of history from the server (rail's load-more). */
  onRequestOlderMessages?: () => void;
  /**
   * While a search/rail jump animates, the transcript window freezes on the
   * target's neighbourhood (message-index range) so its rows exist for the
   * scroll-pin; null when no jump is in flight.
   */
  jumpMessageRange?: { start: number; end: number } | null;
};

/**
 * Rendered by chat's ChatInterface as the scrolling transcript: the message
 * list and tool groups, the export menu, the provider empty state and the
 * load-all-history overlay.
 */
function ChatMessagesPane({
  scrollContainerRef,
  onWheel,
  onTouchMove,
  isLoadingSessionMessages,
  isProcessing = false,
  hasActivityIndicator = false,
  chatMessages,
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  providerModels,
  setProviderModel,
  providerModelCatalog,
  providerModelActions,
  providerModelsLoading,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
  isLoadingMoreMessages,
  hasMoreMessages,
  totalMessages,
  sessionMessagesCount,
  loadAllMessages,
  allMessagesLoaded,
  isLoadingAllMessages,
  loadAllJustFinished,
  showLoadAllOverlay,
  createDiff,
  onEditMessage,
  onForkFromMessage,
  onLoadFullTranscript,
  onSelectPrompt,
  onRequestOlderMessages,
  jumpMessageRange,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  selectedProject,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const lazyRows = useLazyRowObserver(scrollContainerRef);
  const promptEntries = useMemo(() => buildPromptEntries(chatMessages), [chatMessages]);
  const activePromptId = useActivePromptEntry(scrollContainerRef, promptEntries);
  // Grouping runs over the WHOLE transcript, not a loaded slice: the
  // virtualization window must be able to start at any row, and a window cut
  // mid-tool-run would render half a collapsed group. Grouping is a linear
  // pass over plain objects — over a few thousand rows it costs far less
  // than the markdown pipeline it protects against.
  const groupedItems = useMemo(
    () => groupConsecutiveTools(chatMessages, Boolean(showThinking)),
    [chatMessages, showThinking],
  );

  // Stable, deterministic keys for every grouped row this pass.
  //
  // A server refresh can replace source records with equivalent new objects, so
  // object identity is not a durable React key across pagination or hydration.
  // Deriving keys from this pass's ordered messages (intrinsic key,
  // disambiguated by occurrence index on collision) preserves existing DOM
  // nodes and component state when older history is prepended — and doubles
  // as the transcript's virtualization height-cache key.
  const rowKeysData = useMemo(() => {
    const keys: string[] = [];
    const messageKeys = new WeakMap<ChatMessage, string>();
    const occurrences = new Map<string, number>();
    const keyFor = (message: ChatMessage) => {
      const cached = messageKeys.get(message);
      if (cached) return cached;
      const intrinsicKey = getIntrinsicMessageKey(message) ?? 'message-generated';
      const seen = occurrences.get(intrinsicKey) ?? 0;
      occurrences.set(intrinsicKey, seen + 1);
      const key = seen === 0 ? intrinsicKey : `${intrinsicKey}__${seen}`;
      messageKeys.set(message, key);
      return key;
    };
    for (const item of groupedItems) {
      if (isToolGroupItem(item)) {
        keys.push(`tool-group-${keyFor(item.messages[0])}`);
        item.messages.forEach(keyFor);
      } else {
        keys.push(keyFor(item));
      }
    }
    return { keys, messageKeys };
  }, [groupedItems]);
  const rowKeys = rowKeysData.keys;

  const getKey = useCallback(
    (_item: MessageListItem, index: number) => rowKeys[index] ?? `row-${index}`,
    [rowKeys],
  );

  // A rail/search jump addresses rows by MESSAGE index; the virtualization
  // window speaks GROUPED-row index. Map the frozen message range onto the
  // grouped list via each group's first-message index (chatMessages order and
  // groupedItems order agree because grouping only merges neighbours).
  const groupedItemSpans = useMemo(() => {
    const spans: Array<{ start: number; length: number }> = [];
    let messageCursor = 0;
    for (const item of groupedItems) {
      const length = isToolGroupItem(item) ? item.messages.length : 1;
      spans.push({ start: messageCursor, length });
      messageCursor += length;
    }
    return spans;
  }, [groupedItems]);

  const forcedRange = useMemo(() => {
    if (!jumpMessageRange || groupedItems.length === 0) return null;
    let start = groupedItems.length;
    let end = 0;
    for (let index = 0; index < groupedItemSpans.length; index++) {
      const span = groupedItemSpans[index];
      if (span.start + span.length > jumpMessageRange.start && span.start < jumpMessageRange.end) {
        start = Math.min(start, index);
        end = Math.max(end, index + 1);
      }
    }
    return end > start ? { start, end } : null;
  }, [groupedItems, groupedItemSpans, jumpMessageRange]);

  const { range, spacerHeights, virtualized, registerRendered } = useTranscriptVirtualization({
    scrollContainerRef,
    items: groupedItems,
    getKey,
    forcedRange,
    disabled: false,
  });

  // The rail hangs OUTSIDE the message column (left:100%), into the pane
  // margin. Once the pane shrinks below the column's max width plus the rail
  //'s gutter, there is no margin left to hang into and the rail falls past
  // the pane's clipped edge — invisible. Below that threshold (phones always,
  // narrow desktop windows too) the rail docks inside the gutter the message
  // column gives up on its right instead. Measured on the pane, not the
  // viewport: split views and resizable panels change the room without
  // changing the window width.
  const MESSAGE_COLUMN_MAX_PX = 54.25 * 16;
  const RAIL_GUTTER_PX = 48;
  const paneWidth = useElementWidth(scrollContainerRef);
  const railDockedInside = paneWidth > 0 && paneWidth < MESSAGE_COLUMN_MAX_PX + RAIL_GUTTER_PX;

  const getMessageKey = useCallback(
    (message: ChatMessage) =>
      rowKeysData.messageKeys.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated',
    [rowKeysData],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div
      ref={scrollContainerRef}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      className={`chat-messages-pane relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-3 sm:pt-4 ${
        hasActivityIndicator ? 'pb-12 sm:pb-14' : 'pb-3 sm:pb-4'
      }`}
    >
      {chatMessages.length > 0 && (
        <div className="pointer-events-none sticky right-4 top-3 z-10 mb-2 flex justify-end sm:right-[calc(1rem+20px)] sm:px-4">
          <div className="pointer-events-auto">
            <ChatExportMenu
              messages={chatMessages}
              sessionTitle={selectedSession?.summary || selectedSession?.title}
              provider={provider}
              selectedProject={selectedProject}
              createDiff={createDiff}
              onLoadFullTranscript={onLoadFullTranscript}
            />
          </div>
        </div>
      )}
      {/* The rail needs a rail-width gutter on the column's right: on phones
          (always docked) and on any pane too narrow for the rail to hang
          outside the column, the column gives up `pr-10` (+ the scrollbar
          inset on desktop) and the docked rail sits inside it; on a wide pane
          the rail hangs into the pane margin instead and the column only
          keeps the 30px scrollbar clearance. */}
      <div className={cn(
        'mx-auto w-full max-w-[54.25rem] space-y-3 px-4 sm:space-y-4',
        railDockedInside
          ? 'pr-10 sm:pr-[calc(2.5rem+30px)]'
          : 'sm:pr-[calc(1rem+30px)]',
      )}>
      {(isLoadingSessionMessages || isProcessing) && chatMessages.length === 0 ? (
        <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
          <div className="flex items-center justify-center space-x-2">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
            <p>{t('session.loading.sessionMessages')}</p>
          </div>
        </div>
      ) : chatMessages.length === 0 ? (
        <ProviderSelectionEmptyState
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={setProvider}
          textareaRef={textareaRef}
          providerModels={providerModels}
          setProviderModel={setProviderModel}
          providerModelCatalog={providerModelCatalog}
          providerModelActions={providerModelActions}
          providerModelsLoading={providerModelsLoading}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
        />
      ) : (
        <>
          {/* Loading indicator for older messages (hide when load-all is active) */}
          {isLoadingMoreMessages && !isLoadingAllMessages && !allMessagesLoaded && (
            <div className="py-3 text-center text-gray-500 dark:text-gray-400">
              <div className="flex items-center justify-center space-x-2">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
                <p className="text-sm">{t('session.loading.olderMessages')}</p>
              </div>
            </div>
          )}

          {/* Indicator showing there are more messages to load (hide when all loaded) */}
          {hasMoreMessages && !isLoadingMoreMessages && !allMessagesLoaded && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {totalMessages > 0 && (
                <span>
                  {t('session.messages.showingOf', { shown: sessionMessagesCount, total: totalMessages })}{' '}
                  <span className="text-xs">{t('session.messages.scrollToLoad')}</span>
                </span>
              )}
            </div>
          )}

          <LoadAllMessagesOverlay
            showLoadAllOverlay={showLoadAllOverlay}
            isLoadingAllMessages={isLoadingAllMessages}
            loadAllJustFinished={loadAllJustFinished}
            totalMessages={totalMessages}
            onLoadAllMessages={loadAllMessages}
          />

          {/* Legacy message count indicator (for non-paginated view). The rows
              beyond the window load themselves as the user scrolls up (see
              handleScroll's window widening), so there are no manual buttons
              here anymore. */}
          {!hasMoreMessages && range.end < groupedItems.length && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {t('session.messages.showingLast', { count: range.end, total: groupedItems.length })}
            </div>
          )}

          {(() => {
            let prevMessage: ChatMessage | null = null;
            const rowCount = groupedItems.length;

            return groupedItems.map((item, index) => {
              // Rows near the tail mount their content on first commit so the
              // initial scroll-to-bottom measures real heights; older rows
              // start as placeholders and mount when scrolled toward.
              const initiallyNearViewport = index >= rowCount - INITIAL_MOUNTED_TAIL_ROWS;

              if (isToolGroupItem(item)) {
                const groupPrevMessage = prevMessage;
                prevMessage = item.messages[item.messages.length - 1] || prevMessage;

                return (
                  <LazyMessageRow
                    key={`tool-group-${getMessageKey(item.messages[0])}`}
                    lazyRows={lazyRows}
                    timestamp={item.timestamp}
                    initiallyNearViewport={initiallyNearViewport}
                  >
                    <ToolGroupContainer
                      group={item}
                      prevMessage={groupPrevMessage}
                      createDiff={createDiff}
                      getMessageKey={getMessageKey}
                      onFileOpen={onFileOpen}
                      onShowSettings={onShowSettings}
                      onGrantToolPermission={onGrantToolPermission}
                      showRawParameters={showRawParameters}
                      showThinking={showThinking}
                      selectedProject={selectedProject}
                      provider={provider}
                    />
                  </LazyMessageRow>
                );
              }

              const messagePrevMessage = prevMessage;
              prevMessage = item;

              return (
                <LazyMessageRow
                  key={getMessageKey(item)}
                  lazyRows={lazyRows}
                  timestamp={item.timestamp}
                  initiallyNearViewport={initiallyNearViewport}
                >
                  <MessageComponent
                    message={item}
                    prevMessage={messagePrevMessage}
                    createDiff={createDiff}
                    onFileOpen={onFileOpen}
                    onShowSettings={onShowSettings}
                    onGrantToolPermission={onGrantToolPermission}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    selectedProject={selectedProject}
                    provider={provider}
                    onEditMessage={onEditMessage}
                    onForkFromMessage={onForkFromMessage}
                  />
                </LazyMessageRow>
              );
            });
          })()}
        </>
      )}
      </div>
    </div>
      {promptEntries.length > 0 && onSelectPrompt && (
        /* Positioning layer matching the message column width, so the rail
           hugs the right edge of the conversation column rather than the
           window edge (where it collided with the scrollbar and the export
           menu). The layer stays click-through; only the rail itself is
           interactive. */
        <div className="pointer-events-none absolute inset-0 flex justify-center">
          <div className="relative h-full w-full max-w-[54.25rem]">
            <PromptNavigatorRail
              prompts={promptEntries}
              activeId={activePromptId}
              onSelect={onSelectPrompt}
              canLoadEarlier={hasMoreMessages && !allMessagesLoaded}
              isLoadingOlder={isLoadingMoreMessages}
              onLoadEarlier={onRequestOlderMessages ?? loadAllMessages}
              scrollContainerRef={scrollContainerRef}
              dockedInside={railDockedInside}
              loadMoreLabel={t('session.messages.loadEarlier')}
              emptyPreviewLabel={t('promptNavigator.noTextContent', {
                defaultValue: '(no text content)',
              })}
              navigatorLabel={t('promptNavigator.aria', {
                defaultValue: 'Prompt navigator',
              })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ChatMessagesPane);
