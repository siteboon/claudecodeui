import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import PermissionContext from '../../../contexts/PermissionContext';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { ChatInterfaceProps, ChatMessage, Provider  } from '../types/types';
import type { LLMProvider } from '../../../types/app';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useWhisperDictation } from '../hooks/useWhisperDictation';
import { loadWhisperSettings, matchesShortcut, formatShortcut } from '../../settings/view/tabs/VoiceSettingsTab';
import { useSessionStore } from '../../../stores/useSessionStore';

import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import PinnedUserMessage from './subcomponents/PinnedUserMessage';
import PromptNavPanel from './subcomponents/PromptNavPanel';


type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  latestMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onNavigateToSession,
  onShowSettings,
  autoExpandTools,
  collapseToolsByDefault,
  showRawParameters,
  showThinking,
  showCompactSummaries,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  newSessionTrigger,
  onNewSession,
  onShowAllTasks,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { t } = useTranslation('chat');

  const [showPromptNav, setShowPromptNav] = useState(false);

  const sessionStore = useSessionStore();
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    accumulatedStreamRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    geminiModel,
    setGeminiModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  } = useChatProviderState({
    selectedSession,
  });

  const {
    chatMessages,
    addMessage,
    clearMessages,
    rewindMessages,
    removeLastUserMessage,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    claudeStatus,
    setClaudeStatus,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    autoScrollToBottom,
    externalMessageUpdate,
    newSessionTrigger,
    processingSessions,
    resetStreamingState,
    pendingViewSessionRef,
    sessionStore,
  });

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker,
    queuedPrompt,
    clearQueuedPrompt,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    permissionMode,
    cyclePermissionMode,
    cursorModel,
    claudeModel,
    codexModel,
    geminiModel,
    isLoading,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionActive,
    onSessionProcessing,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    pendingViewSessionRef,
    scrollToBottom,
    chatMessages,
    addMessage,
    clearMessages,
    rewindMessages,
    removeLastUserMessage,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
  });

  // When the browser tab becomes visible again, re-query session status so:
  // (1) isLoading/spinner is cleared if the session finished while the tab was hidden,
  // (2) this window registers as a broadcast subscriber if the session is still running.
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && currentSessionId && ws) {
        sendMessage({ type: 'check-session-status', sessionId: currentSessionId, provider });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [currentSessionId, ws, sendMessage, provider]);

  // On WebSocket reconnect, re-fetch the current session's messages from the server
  // so missed streaming events are shown. Also reset isLoading.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    const providerVal = (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
    await sessionStore.refreshFromServer(selectedSession.id, {
      provider: (selectedSession.__provider || providerVal) as LLMProvider,
      // Use DB projectId; legacy folder-derived projectName is no longer accepted here.
      projectId: selectedProject.projectId,
      projectPath: selectedProject.fullPath || selectedProject.path || '',
    });
    setIsLoading(false);
    setCanAbortSession(false);
  }, [selectedProject, selectedSession, sessionStore, setIsLoading, setCanAbortSession]);

  useChatRealtimeHandlers({
    latestMessage,
    provider,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamTimerRef,
    accumulatedStreamRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onNavigateToSession,
    onWebSocketReconnect: handleWebSocketReconnect,
    sessionStore,
  });

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  const userMessages = useMemo(
    () => chatMessages.filter((m) => m.type === 'user'),
    [chatMessages],
  );

  const lastUserMessage = useMemo(() => {
    const last = userMessages[userMessages.length - 1];
    return last ? String(last.content || '') : null;
  }, [userMessages]);

  const userPrompts = useMemo(
    () =>
      userMessages.map((m, idx) => ({
        id: String(m.timestamp || idx),
        text: String(m.content || ''),
        timestamp: (m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp) ?? Date.now(),
      })),
    [userMessages],
  );

  const handleJumpToPrompt = useCallback((id: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-message-timestamp="${CSS.escape(id)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('ring-2', 'ring-primary/40', 'rounded-xl');
      setTimeout(() => {
        target.classList.remove('ring-2', 'ring-primary/40', 'rounded-xl');
      }, 1500);
    }
  }, [scrollContainerRef]);

  const { state: dictationState, errorMessage: dictationError, toggleRecording } = useWhisperDictation({
    onTranscription: (text) => {
      setInput((prev) => prev ? `${prev} ${text}` : text);
    },
  });

  const dictationShortcutLabel = formatShortcut(loadWhisperSettings().shortcut);

  useEffect(() => {
    const handleDictationShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented) return;
      const { shortcut } = loadWhisperSettings();
      if (matchesShortcut(event, shortcut)) {
        event.preventDefault();
        toggleRecording();
      }
    };
    document.addEventListener('keydown', handleDictationShortcut, { capture: true });
    return () => document.removeEventListener('keydown', handleDictationShortcut, { capture: true });
  }, [toggleRecording]);

  const handleForkFromMessage = useCallback((message: ChatMessage) => {
    if (!selectedProject) return;
    const forkContent = String(message.content || '');
    onNewSession?.(selectedProject);
    setInput(forkContent);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [selectedProject, onNewSession, setInput, textareaRef]);

  if (!selectedProject) {
    const selectedProviderLabel =
      provider === 'cursor'
        ? t('messageTypes.cursor')
        : provider === 'codex'
          ? t('messageTypes.codex')
          : provider === 'gemini'
            ? t('messageTypes.gemini')
            : t('messageTypes.claude');

    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className="flex h-full flex-col">
        {chatMessages.length > 0 && (
          <div className="px-2 pt-2 sm:px-4">
            <PinnedUserMessage lastUserMessage={lastUserMessage} />
          </div>
        )}
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          geminiModel={geminiModel}
          setGeminiModel={setGeminiModel}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={chatMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          autoExpandTools={autoExpandTools}
          collapseToolsByDefault={collapseToolsByDefault}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          showCompactSummaries={showCompactSummaries}
          selectedProject={selectedProject}
          onForkFromMessage={handleForkFromMessage}
        />

        <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          claudeStatus={claudeStatus}
          messages={chatMessages}
          isLoading={isLoading}
          onAbortSession={handleAbortSession}
          provider={provider}
          permissionMode={permissionMode}
          onModeSwitch={cyclePermissionMode}
          thinkingMode={thinkingMode}
          setThinkingMode={setThinkingMode}
          tokenBudget={tokenBudget}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          isUserScrolledUp={isUserScrolledUp}
          hasMessages={chatMessages.length > 0}
          onScrollToBottom={scrollToBottomAndReset}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedImages={attachedImages}
          onRemoveImage={(index) =>
            setAttachedImages((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openImagePicker={openImagePicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          placeholder={t('input.placeholder', {
            provider:
              provider === 'cursor'
                ? t('messageTypes.cursor')
                : provider === 'codex'
                  ? t('messageTypes.codex')
                  : provider === 'gemini'
                    ? t('messageTypes.gemini')
                    : t('messageTypes.claude'),
          })}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
          onOpenSettings={onShowSettings}
          currentModel={provider === 'cursor' ? cursorModel : provider === 'codex' ? codexModel : provider === 'gemini' ? geminiModel : claudeModel}
          onModelChange={(model) => {
            if (provider === 'cursor') setCursorModel(model);
            else if (provider === 'codex') setCodexModel(model);
            else if (provider === 'gemini') setGeminiModel(model);
            else setClaudeModel(model);
          }}
          queuedPrompt={queuedPrompt}
          onClearQueuedPrompt={clearQueuedPrompt}
          onTogglePromptNav={() => setShowPromptNav((v) => !v)}
          dictationState={dictationState}
          dictationError={dictationError}
          onToggleDictation={toggleRecording}
          dictationShortcutLabel={dictationShortcutLabel}
        />
      </div>

      <PromptNavPanel
        isOpen={showPromptNav}
        onClose={() => setShowPromptNav(false)}
        prompts={userPrompts}
        onJumpTo={handleJumpToPrompt}
      />

      <QuickSettingsPanel />
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
