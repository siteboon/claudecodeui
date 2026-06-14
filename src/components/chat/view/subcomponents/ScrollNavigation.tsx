import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import type { ChatMessage } from '../../types/types';
import Tooltip from '../../../../shared/view/ui/Tooltip';

// ── Icon SVGs ──

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 7L6 4L3 7" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 5L6 8L9 5" />
    </svg>
  );
}

function TopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 5h8" />
      <path d="M6 2L3.5 5.5h5z" />
    </svg>
  );
}

function BottomIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3.5 6.5L6 10l2.5-3.5" />
      <path d="M2 7h8" />
    </svg>
  );
}

function LoadAllIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 3h8M1 5h6M1 7h7" />
    </svg>
  );
}

// ── Types ──

type MessageDotType = 'user' | 'assistant' | 'tool' | 'system';

// ── Helpers ──

function getMessageDotType(msg: ChatMessage): MessageDotType {
  if (msg.type === 'user') return 'user';
  if (msg.isToolUse || msg.isSubagentContainer || msg.isLocalCommand) return 'tool';
  if (msg.commandName) return 'system';
  return 'assistant';
}

function truncateSnippet(content: string, maxLen = 120): string {
  return (content || '')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, maxLen) + ((content || '').length > maxLen ? '...' : '');
}

function formatMessageTime(ts: string | number | Date): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ── Dot shape renderer ──

function DotShape({ type, isActive, isBookmarked, dotSize }: {
  type: MessageDotType;
  isActive: boolean;
  isBookmarked: boolean;
  dotSize: 'sm' | 'md' | 'lg';
}) {
  const sizeClass = dotSize === 'lg' ? 'w-2.5 h-2.5' : dotSize === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5';

  if (type === 'user') {
    return (
      <div
        className={`rounded-full transition-all duration-150 ${sizeClass} ${
          isBookmarked ? 'bg-yellow-500' : isActive ? 'bg-blue-500' : 'bg-muted-foreground/60'
        }`}
      />
    );
  }

  if (type === 'tool') {
    return (
      <div
        className={`rounded-[1px] transition-all duration-150 ${sizeClass} ${
          isActive ? 'bg-orange-500' : 'bg-orange-400/50'
        }`}
      />
    );
  }

  if (type === 'system') {
    return (
      <div
        className={`transition-all duration-150 ${sizeClass} ${
          isActive ? 'bg-red-500' : 'bg-red-400/40'
        }`}
        style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }}
      />
    );
  }

  // assistant - diamond shape
  return (
    <div
      className={`transition-all duration-150 rotate-45 ${
        dotSize === 'lg' ? 'w-2 h-2' : dotSize === 'md' ? 'w-1.5 h-1.5' : 'w-1 h-1'
      } ${isActive ? 'bg-blue-300' : 'bg-muted-foreground/40'}`}
    />
  );
}

// ── Bookmark storage ──

const BOOKMARK_KEY = 'cloudcli:timeline_bookmarks';

function getBookmarks(sessionId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${BOOKMARK_KEY}_${sessionId}`);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function toggleBookmark(sessionId: string, msgId: string): Set<string> {
  const bookmarks = getBookmarks(sessionId);
  const next = new Set(bookmarks);
  if (next.has(msgId)) {
    next.delete(msgId);
  } else {
    next.add(msgId);
  }
  try {
    localStorage.setItem(`${BOOKMARK_KEY}_${sessionId}`, JSON.stringify([...next]));
  } catch { /* quota exceeded, ignore */ }
  return next;
}

// ── Props ──
// NOTE: `chatMessages` must match what the DOM renders (visibleMessages),
// so that DOM querySelectorAll('.chat-message') indices align with timeline nodes.

interface ScrollNavigationProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  chatMessages: ChatMessage[];
  loadAllMessages?: () => void;
  hasMoreMessages?: boolean;
  sessionId?: string;
  onExportSession?: () => void;
}

// ── Main component ──

/** Vertical scroll navigation strip with multi-type dots, quick-jump buttons, bookmarks, and load-more controls. */
export default function ScrollNavigation({
  scrollContainerRef,
  chatMessages,
  loadAllMessages,
  hasMoreMessages = false,
  sessionId = '',
  onExportSession,
}: ScrollNavigationProps) {
  const { t } = useTranslation('chat');
  const [activeDotIndex, setActiveDotIndex] = useState(-1);
  const [isStripHovered, setIsStripHovered] = useState(false);
  const [focusedDotIndex, setFocusedDotIndex] = useState(-1);
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => new Set());
  const rafIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const skipUpdateRef = useRef(false);

  const shouldShow = chatMessages.length >= 1;
  const hasMore = hasMoreMessages;

  // Build timeline nodes from the visible messages (same as DOM renders).
  // Each node's domIndex matches querySelectorAll('.chat-message') position.
  const timelineNodes = useMemo(() => {
    const nodes: { domIndex: number; dotType: MessageDotType; snippet: string; time: string; bookmarkId: string }[] = [];
    chatMessages.forEach((m, domIndex) => {
      if (m.isStreaming) return;
      if (m.type !== 'user') return;
      nodes.push({
        domIndex,
        dotType: 'user',
        snippet: truncateSnippet(m.content || m.displayText || ''),
        time: formatMessageTime(m.timestamp),
        bookmarkId: `bm-${String(m.timestamp).slice(0, 13)}-${(m.content || '').slice(0, 20).replace(/\s+/g, '_')}`,
      });
    });
    return nodes;
  }, [chatMessages]);

  // Keep a stable ref so scroll handler doesn't need to be recreated on messages change
  const timelineNodesRef = useRef(timelineNodes);
  useEffect(() => {
    timelineNodesRef.current = timelineNodes;
  });

  // Sync bookmarks when session changes
  useEffect(() => {
    if (sessionId) setBookmarks(getBookmarks(sessionId));
  }, [sessionId]);

  const bookmarkCount = bookmarks.size;

  // Adaptive density based on node count
  const dotSize: 'sm' | 'md' | 'lg' = timelineNodes.length > 100 ? 'sm' : timelineNodes.length > 30 ? 'md' : 'lg';

  // Scroll tracking - active dot follows viewport center
  const scheduleUpdate = useCallback((force: boolean = false) => {
    if (rafIdRef.current != null && !force) return;
    if (!force) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (skipUpdateRef.current) {
          skipUpdateRef.current = false;
          return;
        }
        performUpdate();
      });
    } else {
      performUpdate();
    }
  }, [scrollContainerRef]);

  const performUpdate = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const maxScroll = scrollHeight - clientHeight;
    const nodes = timelineNodesRef.current;
    if (maxScroll <= 0) {
      setActiveDotIndex(nodes.length > 0 ? nodes.length - 1 : -1);
      return;
    }

    if (nodes.length <= 1) {
      setActiveDotIndex(0);
      return;
    }

    // Find the DOM element at viewport center, then map to timeline node index
    const elements = container.querySelectorAll<HTMLDivElement>('.chat-message');
    const viewportCenter = scrollTop + clientHeight / 2;
    let activeDomIdx = elements.length - 1;
    for (let i = 0; i < elements.length; i++) {
      const top = elements[i].getBoundingClientRect().top - container.getBoundingClientRect().top + scrollTop;
      if (top <= viewportCenter) {
        activeDomIdx = i;
      } else {
        break;
      }
    }
    // If viewport center is on a filtered-out message (e.g. streaming),
    // fall back to the last visible node before that position.
    let activeNodeIdx = nodes.findIndex((n) => n.domIndex === activeDomIdx);
    if (activeNodeIdx < 0) {
      activeNodeIdx = nodes.reduce((best, n, idx) => n.domIndex <= activeDomIdx ? idx : best, -1);
    }
    if (mountedRef.current) setActiveDotIndex(activeNodeIdx >= 0 ? activeNodeIdx : -1);
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', scheduleUpdate, { passive: true });
    return () => container.removeEventListener('scroll', scheduleUpdate);
  }, [scrollContainerRef, scheduleUpdate]);

  // Show active dot immediately when messages are first available
  useEffect(() => {
    if (timelineNodes.length > 0) {
      scheduleUpdate(true);
    }
  }, [timelineNodes.length, scheduleUpdate]);

  // Re-compute active dot on message count changes
  useEffect(() => {
    const timer = setTimeout(() => scheduleUpdate(), 200);
    return () => clearTimeout(timer);
  }, [chatMessages.length, scheduleUpdate]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // ── Scroll actions ──

  const scrollToNode = useCallback(
    (nodeIndex: number) => {
      const node = timelineNodes[nodeIndex];
      if (!node) return;
      setActiveDotIndex(nodeIndex);
      skipUpdateRef.current = true;
      const container = scrollContainerRef.current;
      if (!container) return;

      const elements = container.querySelectorAll<HTMLDivElement>('.chat-message');
      if (elements.length > node.domIndex) {
        elements[node.domIndex].scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    },
    [scrollContainerRef, timelineNodes],
  );

  const scrollToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) container.scrollTop = 0;
  }, [scrollContainerRef]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [scrollContainerRef]);

  const scrollPrev = useCallback(() => {
    const nodes = timelineNodesRef.current;
    if (nodes.length === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const elements = container.querySelectorAll<HTMLDivElement>('.chat-message');

    const { scrollTop, clientHeight } = container;
    const viewportCenter = scrollTop + clientHeight / 2;

    let currentNodeIdx = -1;
    for (let i = 0; i < elements.length; i++) {
      const top = elements[i].getBoundingClientRect().top - container.getBoundingClientRect().top + scrollTop;
      if (top > viewportCenter) break;
      const nodeIdx = nodes.findIndex(n => n.domIndex === i);
      if (nodeIdx >= 0) currentNodeIdx = nodeIdx;
    }

    const targetNodeIdx = Math.max(0, currentNodeIdx - 1);
    scrollToNode(targetNodeIdx);
  }, [scrollContainerRef, scrollToNode]);

  const scrollNext = useCallback(() => {
    const nodes = timelineNodesRef.current;
    if (nodes.length === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const elements = container.querySelectorAll<HTMLDivElement>('.chat-message');

    const { scrollTop, clientHeight } = container;
    const viewportCenter = scrollTop + clientHeight / 2;

    let currentNodeIdx = -1;
    for (let i = 0; i < elements.length; i++) {
      const top = elements[i].getBoundingClientRect().top - container.getBoundingClientRect().top + scrollTop;
      if (top > viewportCenter) break;
      const nodeIdx = nodes.findIndex(n => n.domIndex === i);
      if (nodeIdx >= 0) currentNodeIdx = nodeIdx;
    }

    const targetNodeIdx = Math.min(nodes.length - 1, currentNodeIdx + 1);
    scrollToNode(targetNodeIdx);
  }, [scrollContainerRef, scrollToNode]);

  // ── Bookmark ──

  const handleToggleBookmark = useCallback((nodeIndex: number) => {
    const node = timelineNodes[nodeIndex];
    if (!node || !sessionId) return;
    const next = toggleBookmark(sessionId, node.bookmarkId);
    setBookmarks(next);
  }, [timelineNodes, sessionId]);

  // ── Keyboard navigation ──

  useEffect(() => {
    if (!isStripHovered) return;

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'j') {
        e.preventDefault();
        setFocusedDotIndex((prev) => Math.min(prev + 1, timelineNodes.length - 1));
      } else if (e.key === 'k') {
        e.preventDefault();
        setFocusedDotIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusedDotIndex >= 0) {
        e.preventDefault();
        scrollToNode(focusedDotIndex);
      } else if (e.key === 'Escape') {
        setFocusedDotIndex(-1);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isStripHovered, timelineNodes.length, focusedDotIndex, scrollToNode]);

  // ── Nav buttons ──

  const navButtons = [
    { label: t('scrollNav.first'), icon: <TopIcon />, action: scrollToTop, disabled: false },
    { label: t('scrollNav.previous'), icon: <ArrowUpIcon />, action: scrollPrev, disabled: false },
    { label: t('scrollNav.next'), icon: <ArrowDownIcon />, action: scrollNext, disabled: false },
    { label: t('scrollNav.last'), icon: <BottomIcon />, action: scrollToBottom, disabled: false },
  ];

  if (!shouldShow) return null;

  return (
    <div className="flex h-full flex-col items-center border-l border-border/30 bg-background/50 backdrop-blur-sm">
      {/* Session actions */}
      <div className="flex flex-col items-center gap-0.5 py-1">
        {onExportSession && (
          <Tooltip content={t('scrollNav.export')} position="left" delay={150}>
            <button
              type="button"
              onClick={onExportSession}
              className="rounded p-1 text-muted-foreground transition-all duration-150 hover:text-foreground"
              aria-label={t('scrollNav.export')}
            >
              <Download size={12} />
            </button>
          </Tooltip>
        )}
        {loadAllMessages && (
          <Tooltip content={t('scrollNav.loadAll')} position="left" delay={150}>
            <button
              type="button"
              onClick={loadAllMessages}
              className={`rounded p-1 transition-all duration-150 ${
                hasMore
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'text-muted-foreground/30 cursor-default'
              }`}
              aria-label={t('scrollNav.loadAll')}
              disabled={!hasMore}
            >
              <LoadAllIcon />
            </button>
          </Tooltip>
        )}

        {navButtons.map((btn) => (
          <Tooltip key={btn.label} content={btn.label} position="left" delay={150}>
            <button
              type="button"
              onClick={btn.action}
              disabled={btn.disabled}
              className={`rounded p-1 transition-all duration-150 ${
                btn.disabled
                  ? 'text-muted-foreground/30 cursor-default'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label={btn.label}
            >
              {btn.icon}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Divider */}
      <div className="w-5 border-t border-border/40" />

      {/* Bookmark count badge */}
      {bookmarkCount > 0 && (
        <Tooltip
          content={t('scrollNav.bookmarks', { count: bookmarkCount })}
          position="left"
          delay={150}
        >
          <div className="flex items-center justify-center px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
            ★ {bookmarkCount}
          </div>
        </Tooltip>
      )}

      {/* Timeline dots */}
      <div
        className="flex flex-1 w-full flex-col items-center justify-evenly py-1 overflow-hidden"
        onMouseEnter={() => setIsStripHovered(true)}
        onMouseLeave={() => { setIsStripHovered(false); setFocusedDotIndex(-1); }}
      >
        {timelineNodes.map((node) => {
          const isActive = timelineNodes.indexOf(node) === activeDotIndex;
          const isFocused = timelineNodes.indexOf(node) === focusedDotIndex;
          const isBookmarked = bookmarks.has(node.bookmarkId);

          const dotSizeClass = isFocused ? 'lg' : isActive ? 'md' : dotSize;

          return (
            <Tooltip
              key={node.bookmarkId}
              content={
                <div className="max-w-[200px]">
                  <div className="text-xs font-medium text-gray-100 dark:text-gray-900 truncate">
                    {t('scrollNav.jumpTo', { snippet: node.snippet })}
                  </div>
                  <div className="text-[10px] text-gray-300 dark:text-gray-600 mt-0.5">
                    {node.time} · {node.dotType}
                  </div>
                </div>
              }
              position="left"
              delay={150}
            >
              <button
                type="button"
                onClick={() => scrollToNode(timelineNodes.indexOf(node))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  handleToggleBookmark(timelineNodes.indexOf(node));
                }}
                className={`flex items-center justify-center cursor-pointer transition-all duration-150 ${
                  isFocused ? 'scale-150' : 'hover:scale-125'
                }`}
                style={{
                  outline: isFocused ? '2px solid hsl(220 90% 55%)' : 'none',
                  outlineOffset: '2px',
                  borderRadius: isFocused ? '2px' : '0',
                }}
                aria-label={t('scrollNav.jumpToMessage', { index: timelineNodes.indexOf(node) + 1 })}
              >
                <DotShape
                  type={node.dotType}
                  isActive={isActive}
                  isBookmarked={isBookmarked}
                  dotSize={dotSizeClass}
                />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
