import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '@/shared/types';

type ChatNavigationRailProps = {
  /**
   * The transcript as currently loaded (chatMessages). The rail first lists
   * the loaded window's user turns, then every turn of the session once the
   * entry fetch below lands in the store.
   */
  messages: ChatMessage[];
  /** The session being viewed; a change re-fetches the full turn list. */
  sessionId: string | null;
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** Reveals one row even outside the visible window; chat's revealMessage. */
  onReveal: (message: ChatMessage) => void;
  /**
   * Loads the whole transcript into the session store without touching the
   * render window (the same load export uses); chat's loadFullTranscript.
   * The store widens chatMessages to the full list, the rail re-derives its
   * turns from the messages prop, and the page keeps rendering its tail
   * window — the rail's data load and the page's load stay independent.
   */
  onLoadFullTranscript: () => Promise<ChatMessage[]>;
};

/** Preview text for one user turn: displayText over content, whitespace collapsed. */
const getTurnPreview = (turn: ChatMessage, attachmentLabel: string): string => {
  const text = (turn.displayText ?? turn.content ?? '').replace(/\s+/g, ' ').trim();
  if (text) {
    return text;
  }
  return turn.images?.length || turn.files?.length ? attachmentLabel : '';
};

/**
 * Used by chat's ChatInterface as the DeepSeek-style turn rail over the right
 * edge of the transcript: one bounded list of user turns that collapses to a
 * column of dashes and expands in place, on hover, into a preview list —
 * never a second panel beside the dash column. Clicking a turn scrolls the
 * transcript to it through revealMessage, which also widens the render
 * window only as far as that turn needs.
 *
 * The full transcript is fetched on session entry (not on first hover), so
 * every turn is listed as soon as the session opens.
 *
 * Rendered as a sibling of the scroll container, never inside it: the pane
 * scrolls and its `contain: paint` would clip (and scroll away) an in-pane
 * rail.
 */
export default function ChatNavigationRail({
  messages,
  sessionId,
  scrollContainerRef,
  onReveal,
  onLoadFullTranscript,
}: ChatNavigationRailProps) {
  const { t } = useTranslation('chat');

  const turns = useMemo(() => messages.filter((message) => message.type === 'user'), [messages]);

  // The rail's listing is independent of the page's render window: entering a
  // session fetches the whole transcript into the store (the page keeps its
  // tail window), so the rail is complete before any hover or scroll-up. A
  // failed fetch leaves the loaded-window listing; re-entering the session
  // fires this effect again.
  useEffect(() => {
    if (!sessionId) {
      return;
    }
    onLoadFullTranscript().catch(() => {});
  }, [sessionId, onLoadFullTranscript]);

  // Timestamp -> turn index, first occurrence winning on collision. Looked up
  // against the pane's `data-message-timestamp` attributes with the same
  // String() coercion React used to render them (and that revealMessage's
  // exact-match lookup already relies on).
  const indexByTimestamp = useMemo(() => {
    const map = new Map<string, number>();
    turns.forEach((turn, index) => {
      const key = String(turn.timestamp);
      if (!map.has(key)) {
        map.set(key, index);
      }
    });
    return map;
  }, [turns]);

  // The user turn at the reading position. Drives dash and row highlighting;
  // updated only by the scroll-spy so it never fights a click-driven reveal.
  const [activeIndex, setActiveIndex] = useState(0);

  // The expanded card is the collapsed dash column with its rows' text shown,
  // so the panel mounts only while hovered and a fully loaded long transcript
  // does not permanently carry the text in the DOM.
  const [isExpanded, setIsExpanded] = useState(false);

  // The active row — collapsed and expanded are the same rows, so one ref
  // covers both states and brings the current turn into view whenever the
  // reading position moves or the rail expands.
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || turns.length === 0) {
      return undefined;
    }

    const measure = () => {
      // Reading line at the pane's vertical center: it matches revealMessage's
      // block:'center' scroll, so after a click-driven jump the highlight
      // lands on exactly the turn that was clicked. Derived from the bounds
      // rect (not clientHeight) so tests can pin the geometry through it.
      const bounds = container.getBoundingClientRect();
      const readingLine = (bounds.top + bounds.bottom) / 2;
      let next = 0;
      for (const row of container.querySelectorAll<HTMLElement>('[data-message-timestamp]')) {
        const index = indexByTimestamp.get(row.getAttribute('data-message-timestamp') ?? '');
        if (index === undefined) {
          continue;
        }
        // Rows come back in document order and stack downward, so the first
        // turn below the line ends the scan; rows above it never reappear.
        if (row.getBoundingClientRect().top > readingLine) {
          break;
        }
        next = index;
      }
      setActiveIndex((prev) => (prev === next ? prev : next));
    };

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    // The initial call also covers pagination widening and load-all, which
    // re-run this effect through the `turns` dependency.
    measure();
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
    };
  }, [turns, indexByTimestamp, scrollContainerRef]);

  useEffect(() => {
    // Keep the active turn visible in the rail's own scrolling list. Only
    // this list can scroll here — the transcript's scroll container is a
    // sibling, not an ancestor, so this cannot move the transcript; do not
    // "fix" it into a manual scrollTop.
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isExpanded, activeIndex, turns]);

  if (turns.length === 0) {
    return null;
  }

  const goToTurnLabel = (index: number) =>
    t('navRail.goToTurn', { index: index + 1, defaultValue: 'Go to message {{index}}' });
  const attachmentLabel = t('navRail.attachmentPreview', { defaultValue: 'Attachment' });

  return (
    <div
      role="navigation"
      aria-label={t('navRail.label', { defaultValue: 'Conversation navigation' })}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      className="absolute right-4 top-1/2 z-10 hidden -translate-y-1/2 md:block"
    >
      {/* One region, not two: collapsed, each row shows only its dash; on
          hover the same rows grow their preview text in place into the card.
          Rows keep one fixed height across the swap so the cursor never leaves
          the row it pointed at, and max-h-72 bounds long sessions in both
          states — the column never grows unbounded down the page. The
          scrollbar hides only while collapsed (hover = expanded, driven by
          state rather than CSS hover so the show rule never has to outrank
          the hide one), so the dashes do not wear a permanent bar. */}
      <div
        className={`max-h-72 overflow-y-auto p-1 ${
          isExpanded
            ? 'w-72 rounded-lg border border-border/50 bg-card/95 shadow-lg backdrop-blur'
            : '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        }`}
      >
        {turns.map((turn, index) => {
          const preview = getTurnPreview(turn, attachmentLabel);
          const isActive = index === activeIndex;
          return (
            <button
              type="button"
              key={`${String(turn.timestamp)}-${index}`}
              ref={isActive ? activeRowRef : undefined}
              aria-current={isActive ? 'location' : undefined}
              aria-label={isExpanded ? (preview || goToTurnLabel(index)) : goToTurnLabel(index)}
              title={preview || goToTurnLabel(index)}
              onClick={() => onReveal(turn)}
              className={`group flex h-8 items-center rounded text-xs ${
                isExpanded
                  ? `w-full gap-2 px-2 text-left ${
                      isActive
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    }`
                  : 'pl-2 pr-1.5'
              }`}
            >
              {isExpanded && <span className="min-w-0 flex-1 truncate">{preview}</span>}
              <span
                className={`h-[3px] flex-shrink-0 rounded-full transition-all ${
                  isActive
                    ? 'w-4 bg-blue-500 dark:bg-blue-400'
                    : 'w-2.5 bg-muted-foreground/40 group-hover:bg-muted-foreground'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
