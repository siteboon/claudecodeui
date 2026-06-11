import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../types/types';
import Tooltip from '../../../../shared/view/ui/Tooltip';

interface ScrollNavigationProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  chatMessages: ChatMessage[];
  loadAllMessages?: () => void;
  allMessagesLoaded?: boolean;
  hasMoreMessages?: boolean;
  totalMessages?: number;
  sessionMessagesCount?: number;
}

function truncateSnippet(content: string): string {
  return (content || '')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 60) + ((content || '').length > 60 ? '...' : '');
}

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

/** Vertical scroll navigation strip with dots, quick-jump buttons, and load-more controls. */
/**
 * Floating navigation control for the chat message pane.
 *
 * Renders a vertical rail of user-message markers plus jump-to-top/bottom,
 * previous/next, and load-all controls. Marker positions are derived from the
 * live DOM offsets of each user message inside `scrollContainerRef`, so the
 * active dot tracks the viewport as the user scrolls or content reflows.
 */
export default function ScrollNavigation({
  scrollContainerRef,
  chatMessages,
  loadAllMessages,
  allMessagesLoaded = true,
  hasMoreMessages = false,
  totalMessages = 0,
  sessionMessagesCount = 0,
}: ScrollNavigationProps) {
  const { t } = useTranslation('chat');
  const [activeDotIndex, setActiveDotIndex] = useState(-1);
  const [isStripHovered, setIsStripHovered] = useState(false);
  const rafIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const skipUpdateRef = useRef(false);

  const userMessages = useMemo(
    () => chatMessages.filter((m) => m.type === 'user'),
    [chatMessages],
  );

  const shouldShow = chatMessages.length >= 1;
  const hasMore = hasMoreMessages;

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (skipUpdateRef.current) {
        skipUpdateRef.current = false;
        return;
      }
      const container = scrollContainerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) {
        setActiveDotIndex(userMessages.length > 0 ? userMessages.length - 1 : -1);
        return;
      }

      const totalUserMessages = userMessages.length;
      if (totalUserMessages <= 1) {
        setActiveDotIndex(0);
        return;
      }

      // Use DOM element positions instead of scroll ratio —
      // messages have varying heights so ratio-based indexing drifts.
      const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
      const viewportCenter = scrollTop + clientHeight / 2;
      let activeIdx = elements.length - 1;
      for (let i = 0; i < elements.length; i++) {
        const top = elements[i].getBoundingClientRect().top - container.getBoundingClientRect().top + scrollTop;
        if (top <= viewportCenter) {
          activeIdx = i;
        } else {
          break;
        }
      }
      if (mountedRef.current) setActiveDotIndex(activeIdx);
    });
  }, [scrollContainerRef, userMessages.length]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', scheduleUpdate, { passive: true });
    return () => container.removeEventListener('scroll', scheduleUpdate);
  }, [scrollContainerRef, scheduleUpdate]);

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

  const scrollToDot = useCallback(
    (index: number) => {
      setActiveDotIndex(index);
      skipUpdateRef.current = true;
      const container = scrollContainerRef.current;
      if (!container) return;

      const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
      if (elements.length > index) {
        elements[index].scrollIntoView({ block: 'center', behavior: 'instant' });
        return;
      }

      const totalUserMessages = userMessages.length;
      if (totalUserMessages <= 1) return;

      const targetRatio = index / (totalUserMessages - 1);
      const maxScroll = container.scrollHeight - container.clientHeight;
      container.scrollTop = targetRatio * maxScroll;
    },
    [scrollContainerRef, userMessages.length],
  );

  const scrollToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.scrollTop = 0;
  }, [scrollContainerRef]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
  }, [scrollContainerRef]);

  const scrollPrev = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
    if (elements.length === 0) return;

    const { scrollTop, clientHeight } = container;
    const viewportCenter = scrollTop + clientHeight / 2;

    let currentIndex = 0;
    for (let i = 0; i < elements.length; i++) {
      const top = elements[i].getBoundingClientRect().top - container.getBoundingClientRect().top + scrollTop;
      if (top <= viewportCenter) {
        currentIndex = i;
      } else {
        break;
      }
    }

    const targetIndex = Math.max(0, currentIndex - 1);
    elements[targetIndex].scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [scrollContainerRef]);

  const scrollNext = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
    if (elements.length === 0) return;

    const { scrollTop, clientHeight } = container;
    const viewportCenter = scrollTop + clientHeight / 2;

    let currentIndex = elements.length - 1;
    for (let i = elements.length - 1; i >= 0; i--) {
      const top = elements[i].getBoundingClientRect().top - container.getBoundingClientRect().top + scrollTop;
      if (top <= viewportCenter) {
        currentIndex = i;
        break;
      }
    }

    const targetIndex = Math.min(elements.length - 1, currentIndex + 1);
    elements[targetIndex].scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [scrollContainerRef]);

  if (!shouldShow) return null;

  const hasUserMessages = userMessages.length > 0;
  const navButtons = [
    {
      label: t('scrollNav.first'),
      icon: <TopIcon />,
      action: scrollToTop,
      disabled: false,
    },
    {
      label: t('scrollNav.previous'),
      icon: <ArrowUpIcon />,
      action: scrollPrev,
      disabled: !hasUserMessages,
    },
    {
      label: t('scrollNav.next'),
      icon: <ArrowDownIcon />,
      action: scrollNext,
      disabled: !hasUserMessages,
    },
    {
      label: t('scrollNav.last'),
      icon: <BottomIcon />,
      action: scrollToBottom,
      disabled: false,
    },
  ];

  return (
    <div
      // Offset from the right edge so the rail clears the message pane's native
      // scrollbar (flush at right-0 it covers a classic Windows/Chrome scrollbar,
      // making the scrollbar hard to grab).
      className="pointer-events-none absolute right-3 top-0 z-10 h-full"
    >
      <div
        className={`pointer-events-auto flex h-full flex-col items-center rounded-full border backdrop-blur-sm transition-all duration-200 ${
          isStripHovered
            ? 'w-10 opacity-100'
            : 'w-2 opacity-50'
        } border-border/50 bg-background/80`}
        onMouseEnter={() => setIsStripHovered(true)}
        onMouseLeave={() => setIsStripHovered(false)}
      >
        {/* Nav buttons section */}
        <div className="flex flex-col items-center gap-1 py-1">
          {hasMore && loadAllMessages && (
            <Tooltip content={t('scrollNav.loadAll')} position="left" delay={150}>
              <button
                type="button"
                onClick={loadAllMessages}
                className="rounded p-1 text-muted-foreground transition-all duration-150 hover:text-foreground"
                aria-label={t('scrollNav.loadAll')}
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
                    ? 'cursor-default text-muted-foreground/30'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-label={btn.label}
              >
                {btn.icon}
              </button>
            </Tooltip>
          ))}
        </div>

        {/* Dots section — only render when there are user messages */}
        {userMessages.length > 0 && (
          <>
            {/* Divider */}
            <div className={`mx-auto my-0.5 border-t border-border/40 transition-all duration-150 ${
              isStripHovered ? 'w-5 opacity-100' : 'w-0 opacity-0'
            }`} />

            <div className="flex w-full flex-1 flex-col items-center justify-evenly px-0 py-1">
              {userMessages.map((msg, i) => {
                const isActive = i === activeDotIndex;
                const snippet = truncateSnippet(msg.content || '');

                return (
                  <Tooltip
                    key={`${i}-${String(msg.timestamp).slice(0, 8)}`}
                    content={t('scrollNav.jumpToMessage', {
                      index: i + 1,
                      snippet,
                    })}
                    position="left"
                    delay={150}
                  >
                    <button
                      type="button"
                      onClick={() => scrollToDot(i)}
                      className={`block cursor-pointer rounded-full transition-all duration-150 ${
                        isActive
                          ? 'h-[10px] w-[10px] bg-blue-500 hover:bg-blue-400'
                          : 'h-[7px] w-[7px] bg-muted-foreground/70 hover:h-[9px] hover:w-[9px] hover:bg-muted-foreground'
                      }`}
                      aria-label={t('scrollNav.jumpToMessage', { index: i + 1 })}
                    />
                  </Tooltip>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
