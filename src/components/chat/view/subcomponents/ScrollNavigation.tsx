import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../types/types';
import Tooltip from '../../../../shared/view/ui/Tooltip';

interface ScrollNavigationProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  chatMessages: ChatMessage[];
  loadAllMessages?: () => void;
  allMessagesLoaded?: boolean;
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
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 8V2M5 2L2 5M5 2L8 5" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 2V8M5 8L2 5M5 8L8 5" />
    </svg>
  );
}

function DoubleUpIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 8V3M5 3L2 5.5M5 3L8 5.5" />
      <path d="M5 6V1M5 1L2 3.5M5 1L8 3.5" />
    </svg>
  );
}

function DoubleDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 1V6M5 6L2 3.5M5 6L8 3.5" />
      <path d="M5 3V8M5 8L2 5.5M5 8L8 5.5" />
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

export default function ScrollNavigation({
  scrollContainerRef,
  chatMessages,
  loadAllMessages,
  allMessagesLoaded = true,
  totalMessages = 0,
  sessionMessagesCount = 0,
}: ScrollNavigationProps) {
  const { t } = useTranslation('chat');
  const [activeDotIndex, setActiveDotIndex] = useState(-1);
  const [isStripHovered, setIsStripHovered] = useState(false);
  const rafIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const userMessages = useMemo(
    () => chatMessages.filter((m) => m.type === 'user'),
    [chatMessages],
  );

  const shouldShow = userMessages.length >= 1;
  const hasMore = totalMessages > 0 && sessionMessagesCount > 0 && !allMessagesLoaded;

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) {
        setActiveDotIndex(userMessages.length > 0 ? userMessages.length - 1 : -1);
        return;
      }

      const scrollRatio = scrollTop / maxScroll;
      const totalUserMessages = userMessages.length;
      if (totalUserMessages <= 1) {
        setActiveDotIndex(0);
        return;
      }

      const activeIdx = Math.round(scrollRatio * (totalUserMessages - 1));
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

  // Lazy-load: ensure all messages are loaded before navigating
  const ensureLoaded = useCallback(() => {
    if (hasMore && loadAllMessages) {
      loadAllMessages();
    }
  }, [hasMore, loadAllMessages]);

  // Load all messages after first paint — non-blocking, doesn't delay initial render
  useEffect(() => {
    if (!hasMore || !loadAllMessages) return;
    const idle = (globalThis.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 0)));
    const handle = idle(() => {
      if (mountedRef.current && hasMore) loadAllMessages();
    });
    return () => {
      if ('cancelIdleCallback' in globalThis)
        (globalThis as any).cancelIdleCallback(handle);
      else clearTimeout(handle as any);
    };
  }, [hasMore, loadAllMessages]);

  const scrollToDot = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
      if (elements.length > index) {
        elements[index].scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }

      const totalUserMessages = userMessages.length;
      if (totalUserMessages <= 1) return;

      const targetRatio = index / (totalUserMessages - 1);
      const maxScroll = container.scrollHeight - container.clientHeight;
      container.scrollTo({
        top: targetRatio * maxScroll,
        behavior: 'smooth',
      });
    },
    [scrollContainerRef, userMessages.length],
  );

  const scroll_to_top = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    ensureLoaded();

    const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
    if (elements.length > 0) {
      elements[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    container.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollContainerRef, ensureLoaded]);

  const scroll_to_bottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
    if (elements.length > 0) {
      elements[elements.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [scrollContainerRef]);

  const scroll_prev = useCallback(() => {
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
    elements[targetIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [scrollContainerRef]);

  const scroll_next = useCallback(() => {
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
    elements[targetIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [scrollContainerRef]);

  if (!shouldShow) return null;

  const navButtons = [
    {
      label: t('scrollNav.first'),
      icon: <DoubleUpIcon />,
      action: scroll_to_top,
    },
    {
      label: t('scrollNav.previous'),
      icon: <ArrowUpIcon />,
      action: scroll_prev,
    },
    {
      label: t('scrollNav.next'),
      icon: <ArrowDownIcon />,
      action: scroll_next,
    },
    {
      label: t('scrollNav.last'),
      icon: <DoubleDownIcon />,
      action: scroll_to_bottom,
    },
  ];

  return (
    <div
      className="pointer-events-none absolute right-0 top-0 z-10 h-full"
    >
      <div
        className={`pointer-events-auto flex h-full flex-col items-center rounded-full border backdrop-blur-sm transition-all duration-200 ${
          isStripHovered
            ? 'w-10 opacity-100'
            : 'w-2 opacity-50'
        } bg-background/80 border-border/50`}
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
                className="rounded p-1 text-muted-foreground transition-all duration-150 hover:text-foreground"
                aria-label={btn.label}
              >
                {btn.icon}
              </button>
            </Tooltip>
          ))}
        </div>

        {/* Divider */}
        <div className={`mx-auto my-0.5 border-t border-border/40 transition-all duration-150 ${
          isStripHovered ? 'w-5 opacity-100' : 'w-0 opacity-0'
        }`} />

        {/* Dots section */}
        <div className="flex flex-1 w-full flex-col items-center justify-evenly px-0 py-1">
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
                      : 'h-[7px] w-[7px] bg-muted-foreground/70 hover:bg-muted-foreground hover:h-[9px] hover:w-[9px]'
                  }`}
                  aria-label={t('scrollNav.jumpToMessage', { index: i + 1 })}
                />
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
