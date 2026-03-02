import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { api, authenticatedFetch } from '../../../utils/api';
import type { ChatMessage, Provider } from '../types/types';
import type { Project, ProjectSession } from '../../../types/app';
import { safeLocalStorage } from '../utils/chatStorage';
import {
  convertCursorSessionMessages,
  convertSessionMessages,
  createCachedDiffCalculator,
  type DiffCalculator,
} from '../utils/messageTransforms';

const MESSAGES_PER_PAGE = 20;
const INITIAL_VISIBLE_MESSAGES = 100;

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  processingSessions?: Set<string>;
  resetStreamingState: () => void;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
}

interface ScrollRestoreState {
  height: number;
  top: number;
}

export function useChatSessionState({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  autoScrollToBottom,
  externalMessageUpdate,
  processingSessions,
  resetStreamingState,
  pendingViewSessionRef,
}: UseChatSessionStateArgs) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const saved = safeLocalStorage.getItem(`chat_messages_${selectedProject.name}`);
      if (saved) {
        try {
          return JSON.parse(saved) as ChatMessage[];
        } catch {
          console.error('Failed to parse saved chat messages, resetting');
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
          return [];
        }
      }
      return [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [claudeStatus, setClaudeStatus] = useState<{ text: string; tokens: number; can_interrupt: boolean } | null>(null);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoadedSessionIdRef = useRef<string | null>(null);

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  const loadSessionMessages = useCallback(
    async (projectName: string, sessionId: string, loadMore = false, provider: Provider | string = 'claude') => {
      if (!projectName || !sessionId) {
        return [] as any[];
      }

      const isInitialLoad = !loadMore;
      if (isInitialLoad) {
        setIsLoadingSessionMessages(true);
      } else {
        setIsLoadingMoreMessages(true);
      }

      try {
        const currentOffset = loadMore ? messagesOffsetRef.current : 0;
        const response = await (api.sessionMessages as any)(
          projectName,
          sessionId,
          MESSAGES_PER_PAGE,
          currentOffset,
          provider,
        );
        if (!response.ok) {
          throw new Error('Failed to load session messages');
        }

        const data = await response.json();
        if (isInitialLoad && data.tokenUsage) {
          setTokenBudget(data.tokenUsage);
        }

        if (data.hasMore !== undefined) {
          const loadedCount = data.messages?.length || 0;
          setHasMoreMessages(Boolean(data.hasMore));
          setTotalMessages(Number(data.total || 0));
          messagesOffsetRef.current = currentOffset + loadedCount;
          return data.messages || [];
        }

        const messages = data.messages || [];
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        messagesOffsetRef.current = messages.length;
        return messages;
      } catch (error) {
        console.error('Error loading session messages:', error);
        return [];
      } finally {
        if (isInitialLoad) {
          setIsLoadingSessionMessages(false);
        } else {
          setIsLoadingMoreMessages(false);
        }
      }
    },
    [],
  );

  const loadCursorSessionMessages = useCallback(async (projectPath: string, sessionId: string) => {
    if (!projectPath || !sessionId) {
      return [] as ChatMessage[];
    }

    setIsLoadingSessionMessages(true);
    try {
      const url = `/api/cursor/sessions/${encodeURIComponent(sessionId)}?projectPath=${encodeURIComponent(projectPath)}`;
      const response = await authenticatedFetch(url);
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const blobs = (data?.session?.messages || []) as any[];
      return convertCursorSessionMessages(blobs, projectPath);
    } catch (error) {
      console.error('Error loading Cursor session messages:', error);
      return [];
    } finally {
      setIsLoadingSessionMessages(false);
    }
  }, []);

  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
      allMessagesLoadedRef.current = false;
    }
  }, [allMessagesLoaded, scrollToBottom]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return false;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) {
        return false;
      }
      if (allMessagesLoadedRef.current) return false;
      if (!hasMoreMessages || !selectedSession || !selectedProject) {
        return false;
      }

      const sessionProvider = selectedSession.__provider || 'claude';
      if (sessionProvider === 'cursor') {
        return false;
      }

      isLoadingMoreRef.current = true;
      const previousScrollHeight = container.scrollHeight;
      const previousScrollTop = container.scrollTop;

      try {
        const moreMessages = await loadSessionMessages(
          selectedProject.name,
          selectedSession.id,
          true,
          sessionProvider,
        );

        if (moreMessages.length === 0) {
          return false;
        }

        pendingScrollRestoreRef.current = {
          height: previousScrollHeight,
          top: previousScrollTop,
        };
        setSessionMessages((previous) => [...moreMessages, ...previous]);
        // Keep the rendered window in sync with top-pagination so newly loaded history becomes visible.
        setVisibleMessageCount((previousCount) => previousCount + moreMessages.length);
        return true;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [hasMoreMessages, isLoadingMoreMessages, loadSessionMessages, selectedProject, selectedSession],
  );

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const nearBottom = isNearBottom();
    setIsUserScrolledUp(!nearBottom);

    if (!allMessagesLoadedRef.current) {
      const scrolledNearTop = container.scrollTop < 100;
      if (!scrolledNearTop) {
        topLoadLockRef.current = false;
        return;
      }

      if (topLoadLockRef.current) {
        if (container.scrollTop > 20) {
          topLoadLockRef.current = false;
        }
        return;
      }

      const didLoad = await loadOlderMessages(container);
      if (didLoad) {
        topLoadLockRef.current = true;
      }
    }
  }, [isNearBottom, loadOlderMessages]);

  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) {
      return;
    }

    const { height, top } = pendingScrollRestoreRef.current;
    const container = scrollContainerRef.current;
    const newScrollHeight = container.scrollHeight;
    const scrollDiff = newScrollHeight - height;
    container.scrollTop = top + Math.max(scrollDiff, 0);
    pendingScrollRestoreRef.current = null;
  }, [chatMessages.length]);

  const prevSessionMessagesLengthRef = useRef(0);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    pendingInitialScrollRef.current = true;
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    prevSessionMessagesLengthRef.current = 0;
    isInitialLoadRef.current = true;
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setIsUserScrolledUp(false);
  }, [selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) {
      return;
    }

    if (chatMessages.length === 0) {
      pendingInitialScrollRef.current = false;
      return;
    }

    pendingInitialScrollRef.current = false;
    setTimeout(() => {
      scrollToBottom();
    }, 200);
  }, [chatMessages.length, isLoadingSessionMessages, scrollToBottom]);

  useEffect(() => {
    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        const provider = (localStorage.getItem('selected-provider') as Provider) || 'claude';
        isLoadingSessionRef.current = true;

        const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;
        if (sessionChanged) {
          if (!isSystemSessionChange) {
            resetStreamingState();
            pendingViewSessionRef.current = null;
            setChatMessages([]);
            setSessionMessages([]);
            setClaudeStatus(null);
            setCanAbortSession(false);
          }

          messagesOffsetRef.current = 0;
          setHasMoreMessages(false);
          setTotalMessages(0);
          setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
          setAllMessagesLoaded(false);
          allMessagesLoadedRef.current = false;
          setIsLoadingAllMessages(false);
          setLoadAllJustFinished(false);
          setShowLoadAllOverlay(false);
          if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
          if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
          setTokenBudget(null);
          setIsLoading(false);

          if (ws) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider,
            });
          }
        } else if (currentSessionId === null) {
          messagesOffsetRef.current = 0;
          setHasMoreMessages(false);
          setTotalMessages(0);

          if (ws) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider,
            });
          }
        }

        // Skip loading if session ID hasn't changed and we already loaded it
        if (lastLoadedSessionIdRef.current === selectedSession.id) {
          setTimeout(() => {
            isLoadingSessionRef.current = false;
          }, 250);
          return;
        }

        if (provider === 'cursor') {
          setCurrentSessionId(selectedSession.id);
          sessionStorage.setItem('cursorSessionId', selectedSession.id);

          if (!isSystemSessionChange) {
            const projectPath = selectedProject.fullPath || selectedProject.path || '';
            const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            setIsSystemSessionChange(false);
          }
        } else {
          setCurrentSessionId(selectedSession.id);

          if (!isSystemSessionChange) {
            const messages = await loadSessionMessages(
              selectedProject.name,
              selectedSession.id,
              false,
              selectedSession.__provider || 'claude',
            );
            setSessionMessages(messages);
          } else {
            setIsSystemSessionChange(false);
          }
        }

        // Update the last loaded session ID
        lastLoadedSessionIdRef.current = selectedSession.id;
      } else {
        if (!isSystemSessionChange) {
          resetStreamingState();
          pendingViewSessionRef.current = null;
          setChatMessages([]);
          setSessionMessages([]);
          setClaudeStatus(null);
          setCanAbortSession(false);
          setIsLoading(false);
        }

        setCurrentSessionId(null);
        sessionStorage.removeItem('cursorSessionId');
        messagesOffsetRef.current = 0;
        setHasMoreMessages(false);
        setTotalMessages(0);
        setTokenBudget(null);
        lastLoadedSessionIdRef.current = null;
      }

      setTimeout(() => {
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
  }, [
    // Intentionally exclude currentSessionId: this effect sets it and should not retrigger another full load.
    isSystemSessionChange,
    loadCursorSessionMessages,
    loadSessionMessages,
    pendingViewSessionRef,
    resetStreamingState,
    selectedProject,
    selectedSession?.id, // Only depend on session ID, not the entire object
    sendMessage,
    ws,
  ]);

  useEffect(() => {
    if (!externalMessageUpdate || !selectedSession || !selectedProject) {
      return;
    }

    const reloadExternalMessages = async () => {
      try {
        const provider = (localStorage.getItem('selected-provider') as Provider) || 'claude';

        if (provider === 'cursor') {
          const projectPath = selectedProject.fullPath || selectedProject.path || '';
          const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
          setSessionMessages([]);
          setChatMessages(converted);
          return;
        }

        const messages = await loadSessionMessages(
          selectedProject.name,
          selectedSession.id,
          false,
          selectedSession.__provider || 'claude',
        );
        setSessionMessages(messages);

        const shouldAutoScroll = Boolean(autoScrollToBottom) && isNearBottom();
        if (shouldAutoScroll) {
          setTimeout(() => scrollToBottom(), 200);
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
  }, [
    autoScrollToBottom,
    externalMessageUpdate,
    isNearBottom,
    loadCursorSessionMessages,
    loadSessionMessages,
    scrollToBottom,
    selectedProject,
    selectedSession,
  ]);

  useEffect(() => {
    if (selectedSession?.id) {
      pendingViewSessionRef.current = null;
    }
  }, [pendingViewSessionRef, selectedSession?.id]);


  useEffect(() => {
    // Only sync sessionMessages to chatMessages when:
    // 1. Not currently loading (to avoid overwriting user's just-sent message)
    // 2. SessionMessages actually changed
    // 3. Either it's initial load OR sessionMessages increased (new messages from server)
    if (
      sessionMessages.length > 0 &&
      sessionMessages.length !== prevSessionMessagesLengthRef.current &&
      !isLoading
    ) {
      // Only update if this is initial load or if sessionMessages grew (server added messages)
      // Don't update if sessionMessages shrunk (user might have just sent a message)
      if (isInitialLoadRef.current || sessionMessages.length > prevSessionMessagesLengthRef.current) {
        setChatMessages(convertedMessages);
        isInitialLoadRef.current = false;
      }
      prevSessionMessagesLengthRef.current = sessionMessages.length;
    }
  }, [convertedMessages, sessionMessages.length, isLoading, setChatMessages]);

  useEffect(() => {
    if (selectedProject && chatMessages.length > 0) {
      safeLocalStorage.setItem(`chat_messages_${selectedProject.name}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, selectedProject]);

  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || selectedSession.id.startsWith('new-session-')) {
      setTokenBudget(null);
      return;
    }

    const sessionProvider = selectedSession.__provider || 'claude';
    if (sessionProvider !== 'claude') {
      return;
    }

    const fetchInitialTokenUsage = async () => {
      try {
        const url = `/api/projects/${selectedProject.name}/sessions/${selectedSession.id}/token-usage`;
        const response = await authenticatedFetch(url);
        if (response.ok) {
          const data = await response.json();
          setTokenBudget(data);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };

    fetchInitialTokenUsage();
  }, [selectedProject, selectedSession?.id, selectedSession?.__provider]);

  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop,
      };
    }
  });

  useEffect(() => {
    if (!scrollContainerRef.current || chatMessages.length === 0) {
      return;
    }

    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) {
      return;
    }

    if (autoScrollToBottom) {
      if (!isUserScrolledUp) {
        setTimeout(() => scrollToBottom(), 50);
      }
      return;
    }

    const container = scrollContainerRef.current;
    const prevHeight = scrollPositionRef.current.height;
    const prevTop = scrollPositionRef.current.top;
    const newHeight = container.scrollHeight;
    const heightDiff = newHeight - prevHeight;

    if (heightDiff > 0 && prevTop > 0) {
      container.scrollTop = prevTop + heightDiff;
    }
  }, [autoScrollToBottom, chatMessages.length, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const activeViewSessionId = selectedSession?.id || currentSessionId;
    if (!activeViewSessionId || !processingSessions) {
      return;
    }

    const shouldBeProcessing = processingSessions.has(activeViewSessionId);
    if (shouldBeProcessing && !isLoading) {
      setIsLoading(true);
      setCanAbortSession(true);
    }
  }, [currentSessionId, isLoading, processingSessions, selectedSession?.id]);

  // Show "Load all" overlay after a batch finishes loading, persist for 2s then hide
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoadingMoreMessages;

    if (wasLoading && !isLoadingMoreMessages && hasMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(true);
      loadAllOverlayTimerRef.current = setTimeout(() => {
        setShowLoadAllOverlay(false);
      }, 2000);
    }
    if (!hasMoreMessages && !isLoadingMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(false);
    }
    return () => {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    };
  }, [isLoadingMoreMessages, hasMoreMessages]);

  const loadAllMessages = useCallback(async () => {
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessages) return;
    const sessionProvider = selectedSession.__provider || 'claude';
    if (sessionProvider === 'cursor') {
      setVisibleMessageCount(Infinity);
      setAllMessagesLoaded(true);
      allMessagesLoadedRef.current = true;
      setLoadAllJustFinished(true);
      if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
      loadAllFinishedTimerRef.current = setTimeout(() => {
        setLoadAllJustFinished(false);
        setShowLoadAllOverlay(false);
      }, 1000);
      return;
    }

    const requestSessionId = selectedSession.id;

    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    setIsLoadingAllMessages(true);
    setShowLoadAllOverlay(true);

    const container = scrollContainerRef.current;
    const previousScrollHeight = container ? container.scrollHeight : 0;
    const previousScrollTop = container ? container.scrollTop : 0;

    try {
      const response = await (api.sessionMessages as any)(
        selectedProject.name,
        requestSessionId,
        null,
        0,
        sessionProvider,
      );

      if (currentSessionId !== requestSessionId) return;

      if (response.ok) {
        const data = await response.json();
        const allMessages = data.messages || data;

        if (container) {
          pendingScrollRestoreRef.current = {
            height: previousScrollHeight,
            top: previousScrollTop,
          };
        }

        setSessionMessages(Array.isArray(allMessages) ? allMessages : []);
        setHasMoreMessages(false);
        setTotalMessages(Array.isArray(allMessages) ? allMessages.length : 0);
        messagesOffsetRef.current = Array.isArray(allMessages) ? allMessages.length : 0;

        setVisibleMessageCount(Infinity);
        setAllMessagesLoaded(true);

        setLoadAllJustFinished(true);
        if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
        loadAllFinishedTimerRef.current = setTimeout(() => {
          setLoadAllJustFinished(false);
          setShowLoadAllOverlay(false);
        }, 1000);
      } else {
        allMessagesLoadedRef.current = false;
        setShowLoadAllOverlay(false);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingAllMessages(false);
    }
  }, [selectedSession, selectedProject, isLoadingAllMessages, currentSessionId]);

  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount((previousCount) => previousCount + 100);
  }, []);

  return {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isSystemSessionChange,
    setIsSystemSessionChange,
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
    isNearBottom,
    handleScroll,
    loadSessionMessages,
    loadCursorSessionMessages,
  };
}
