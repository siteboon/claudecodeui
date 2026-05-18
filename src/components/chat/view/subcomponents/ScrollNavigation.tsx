import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../types/types';
import Tooltip from '../../../../shared/view/ui/Tooltip';

interface ScrollNavigationProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  chatMessages: ChatMessage[];
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

      // Proportional position of scroll within content
      const scrollRatio = scrollTop / maxScroll;
      // Map to the closest user message index
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

  const scrollToDot = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const elements = container.querySelectorAll<HTMLDivElement>('.chat-message.user');
      if (elements.length > index) {
        // Message is rendered, scroll directly
        elements[index].scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }

      // Message not rendered yet — scroll proportionally
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

  if (!shouldShow) return null;

  return (
    <div
      className="pointer-events-none absolute right-0 top-0 z-10 h-full w-5"
    >
      <div
        className={`pointer-events-auto flex h-full w-3 flex-col items-center justify-evenly rounded-full border px-0 py-4 backdrop-blur-sm transition-opacity duration-200 ${
          isStripHovered ? 'opacity-100' : 'opacity-50'
        } bg-background/80 border-border/50`}
        onMouseEnter={() => setIsStripHovered(true)}
        onMouseLeave={() => setIsStripHovered(false)}
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
  );
}
