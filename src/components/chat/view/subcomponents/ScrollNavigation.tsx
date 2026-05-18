import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../types/types';
import Tooltip from '../../../../shared/view/ui/Tooltip';

interface ScrollNavigationProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  chatMessages: ChatMessage[];
  allMessagesLoaded: boolean;
  loadAllMessages: () => void;
}

function truncateSnippet(content: string): string {
  return (content || '')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 60) + ((content || '').length > 60 ? '...' : '');
}

export default function ScrollNavigation({
  scrollContainerRef,
  chatMessages,
  allMessagesLoaded,
  loadAllMessages,
}: ScrollNavigationProps) {
  const { t } = useTranslation('chat');
  const [activeDotIndex, setActiveDotIndex] = useState(-1);
  const [isStripHovered, setIsStripHovered] = useState(false);
  const rafIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const loadAllCalledRef = useRef(false);

  const userMessages = useMemo(
    () => chatMessages.filter((m) => m.type === 'user'),
    [chatMessages],
  );

  const shouldShow = userMessages.length >= 1;

  // Auto-load all messages on first mount so every dot appears
  useEffect(() => {
    if (!allMessagesLoaded && !loadAllCalledRef.current && userMessages.length > 0) {
      loadAllCalledRef.current = true;
      loadAllMessages();
    }
  }, [allMessagesLoaded, loadAllMessages, userMessages.length]);

  // Reset loadAllCalledRef when session changes (messages become empty then refill)
  useEffect(() => {
    if (chatMessages.length === 0) {
      loadAllCalledRef.current = false;
    }
  }, [chatMessages.length]);

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;

      const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
      if (elements.length === 0) {
        setActiveDotIndex(-1);
        return;
      }

      const { scrollTop, clientHeight } = container;
      const viewCenter = scrollTop + clientHeight / 2;

      let bestIndex = 0;
      let bestDist = Infinity;

      elements.forEach((el, i) => {
        const center = el.offsetTop + el.clientHeight / 2;
        const dist = Math.abs(center - viewCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
        }
      });

      if (mountedRef.current) setActiveDotIndex(bestIndex);
    });
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', scheduleUpdate, { passive: true });
    return () => container.removeEventListener('scroll', scheduleUpdate);
  }, [scrollContainerRef, scheduleUpdate]);

  useEffect(() => {
    const timer = setTimeout(() => scheduleUpdate(), 300);
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
      const container = scrollContainerRef.current;
      if (!container) return;
      const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
      const target = elements[index];
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    },
    [scrollContainerRef],
  );

  if (!shouldShow) return null;

  const totalDots = userMessages.length;

  return (
    <div
      className="pointer-events-none absolute right-0.5 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center"
      onMouseEnter={() => setIsStripHovered(true)}
      onMouseLeave={() => setIsStripHovered(false)}
    >
      <div
        className={`pointer-events-auto flex flex-col items-center rounded-full border px-1.5 py-3 backdrop-blur-sm transition-opacity duration-200 ${
          isStripHovered ? 'opacity-100' : 'opacity-50'
        } bg-background/80 border-border/50`}
      >
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
                    ? 'h-[8px] w-[8px] bg-blue-500 hover:bg-blue-400'
                    : 'h-[6px] w-[6px] bg-muted-foreground/70 hover:bg-muted-foreground hover:h-[8px] hover:w-[8px]'
                }`}
                style={{
                  marginBlock: totalDots > 1 ? 6 : 0,
                }}
                aria-label={t('scrollNav.jumpToMessage', { index: i + 1 })}
              />
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
