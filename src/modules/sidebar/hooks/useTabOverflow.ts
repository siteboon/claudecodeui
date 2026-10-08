import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Sub-pixel slack. Widths come from getBoundingClientRect, so a strip that fits
 * exactly can still measure a hundredth of a pixel wider than its container.
 */
const FIT_EPSILON = 0.5;

type TabFitInput = {
  /** Natural width of every tab, in row order. */
  widths: number[];
  /** Natural width of the overflow trigger, which takes the place of the dropped tabs. */
  triggerWidth: number;
  /** Width the row has to lay the tabs out in. */
  available: number;
  /** The tab that must stay in the row, or -1 when none is active. */
  activeIndex: number;
};

/**
 * The tabs the row keeps, in row order. Tabs are kept from the left and the
 * active one is always kept, so the strip still shows which section is on
 * screen even when that section's tab would have fallen past the fold.
 */
export function fitTabsInRow({ widths, triggerWidth, available, activeIndex }: TabFitInput): number[] {
  const everyIndex = widths.map((_, index) => index);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available + FIT_EPSILON) {
    return everyIndex;
  }

  const hasActive = activeIndex >= 0 && activeIndex < widths.length;
  const budget = available - triggerWidth - (hasActive ? widths[activeIndex] : 0);

  const kept: number[] = [];
  let used = 0;
  for (const index of everyIndex) {
    if (index === activeIndex) {
      continue;
    }
    // Stop at the first tab that does not fit rather than skipping over it to a
    // narrower one: the strip reads as a left-to-right list, and a hole in the
    // middle of that list looks like a bug.
    if (used + widths[index] > budget + FIT_EPSILON) {
      break;
    }
    used += widths[index];
    kept.push(index);
  }

  if (hasActive) {
    kept.push(activeIndex);
    kept.sort((first, second) => first - second);
  }
  return kept;
}

const isSameIndexes = (first: number[], second: number[]) =>
  first.length === second.length && first.every((index, position) => index === second[position]);

/**
 * Splits a tab strip into the tabs that fit and the tabs that do not.
 *
 * `rowRef` goes on the element the tabs must fit into and `mirrorRef` on an
 * off-layout copy of the full strip: once a tab has been dropped it is no
 * longer in the row to be measured, so the natural widths have to come from
 * somewhere that always renders all of them.
 */
export function useTabOverflow(tabCount: number, activeIndex: number) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  // The tabs the row has room for. It can only be measured from a laid-out DOM,
  // so it starts as "all of them" and the first layout pass corrects it.
  const [visibleIndexes, setVisibleIndexes] = useState<number[]>(() =>
    Array.from({ length: tabCount }, (_, index) => index),
  );

  const measure = useCallback(() => {
    const row = rowRef.current;
    const mirror = mirrorRef.current;
    if (!row || !mirror) {
      return;
    }

    const measured = Array.from(mirror.children, (child) => child.getBoundingClientRect().width);
    // The mirror holds every tab plus the overflow trigger. A different count
    // means it is mid-render and the widths cannot be trusted yet.
    if (measured.length !== tabCount + 1) {
      return;
    }

    const available = row.getBoundingClientRect().width;
    // The header renders a desktop and a mobile copy of the strip and hides one
    // of them with `display: none`. The hidden copy measures zero — keep its
    // last layout rather than collapsing every tab into the dropdown.
    if (available <= 0) {
      return;
    }

    const next = fitTabsInRow({
      widths: measured.slice(0, tabCount),
      triggerWidth: measured[tabCount],
      available,
      activeIndex,
    });
    setVisibleIndexes((current) => (isSameIndexes(current, next) ? current : next));
  }, [tabCount, activeIndex]);

  useLayoutEffect(() => {
    measure();

    const row = rowRef.current;
    const mirror = mirrorRef.current;
    if (!row || !mirror || typeof ResizeObserver === 'undefined') {
      return;
    }

    // The row changes width while the sidebar is dragged; the mirror changes
    // when the tabs themselves do — a language switch, or the running-session
    // badge appearing next to the Activity icon.
    const observer = new ResizeObserver(() => measure());
    observer.observe(row);
    observer.observe(mirror);
    return () => observer.disconnect();
  }, [measure]);

  return { rowRef, mirrorRef, visibleIndexes };
}
