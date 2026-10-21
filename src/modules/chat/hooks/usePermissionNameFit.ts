import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Sub-pixel slack. Widths come from getBoundingClientRect, so a toolbar that
 * fits exactly can still measure a fraction of a pixel wider than its footer.
 */
const FIT_EPSILON = 0.5;

/** ComposerPermissionMenu's trigger without its name: the 32px (`w-8`) icon button. */
const ICON_ONLY_WIDTH = 32;

/**
 * Room a hidden name needs to spare before it is shown. That is the clear
 * button the composer adds to its left-hand tools once something is typed
 * (32px plus a 4px gap), so the first keystroke never takes back a name that
 * was just shown.
 */
const SHOW_MARGIN = 36;

type PermissionNameFitInput = {
  /** Width the composer footer lays its tools and controls out in (its content box). */
  room: number;
  /** Width of the footer's left-hand tools. */
  toolsWidth: number;
  /** Width of the right-hand controls (schedule, model, permission, send) with the trigger as an icon. */
  controlsWidth: number;
  /** How much wider the trigger is with the name shown. */
  nameWidth: number;
  /** Whether the name may move the controls onto a row of their own. */
  mayWrap: boolean;
  /** Room to spare on top of the name, for a name that is not shown yet. */
  margin: number;
};

/**
 * Whether the permission trigger has room for the mode's name. Never when the
 * name would push the controls past the composer's edge, where the send button
 * is. Unless the name may wrap, only when the whole toolbar, name included,
 * still fits on one row, so naming the mode never moves the model menu and the
 * send button onto a second row that the icon did not need.
 */
function fitsPermissionName({
  room,
  toolsWidth,
  controlsWidth,
  nameWidth,
  mayWrap,
  margin,
}: PermissionNameFitInput): boolean {
  const namedControlsWidth = controlsWidth + nameWidth;
  if (namedControlsWidth > room + FIT_EPSILON) {
    return false;
  }
  return mayWrap || toolsWidth + namedControlsWidth + margin <= room + FIT_EPSILON;
}

/** The composer footer around the trigger, its left-hand tools and the group that holds the trigger. */
const findFooterParts = (trigger: HTMLElement | null) => {
  const footer = trigger?.closest<HTMLElement>('[data-slot="prompt-input-footer"]');
  if (!trigger || !footer) {
    return null;
  }
  const tools = footer.querySelector<HTMLElement>(':scope > [data-slot="prompt-input-tools"]');
  const controls = Array.from(footer.children).find((child) => child !== tools && child.contains(trigger));
  return tools && controls ? { trigger, footer, tools, controls } : null;
};

type NameFit = { name: string; isShown: boolean };

/**
 * Whether ComposerPermissionMenu's trigger shows the active mode's name. It
 * follows the room the composer footer actually has, not the viewport: the code
 * editor docked beside the chat leaves a laptop's composer as narrow as a
 * phone's.
 *
 * `name` is null while the trigger is not rendered. A trigger outside a
 * PromptInputFooter is not measured and keeps its name.
 */
export function usePermissionNameFit(
  triggerRef: RefObject<HTMLButtonElement | null>,
  name: string | null,
  mayWrap: boolean,
): boolean {
  // The trigger's width with each name shown. A hidden name is not in the DOM
  // to measure, so it keeps the width it had when it was last shown.
  const namedWidthsRef = useRef(new Map<string, number>());
  // The last decision. It can only be made from a laid-out DOM, so a name that
  // has none yet is shown, and the layout pass corrects that before it paints.
  const [fit, setFit] = useState<NameFit | null>(null);
  const isDecided = name !== null && fit?.name === name;
  const isShown = isDecided ? fit.isShown : true;

  const measure = useCallback(() => {
    const parts = name === null ? null : findFooterParts(triggerRef.current);
    if (name === null || !parts) {
      return;
    }

    const { trigger, footer, tools, controls } = parts;
    const footerStyle = getComputedStyle(footer);
    const room = footer.clientWidth
      - (parseFloat(footerStyle.paddingLeft) || 0)
      - (parseFloat(footerStyle.paddingRight) || 0);
    // A composer in a hidden tab measures zero: keep its last decision.
    if (room <= 0) {
      return;
    }

    const triggerWidth = trigger.getBoundingClientRect().width;
    if (isShown) {
      namedWidthsRef.current.set(name, triggerWidth);
    }
    const namedWidth = namedWidthsRef.current.get(name) ?? triggerWidth;

    const next = fitsPermissionName({
      room,
      toolsWidth: tools.getBoundingClientRect().width,
      controlsWidth: controls.getBoundingClientRect().width - triggerWidth + ICON_ONLY_WIDTH,
      nameWidth: namedWidth - ICON_ONLY_WIDTH,
      mayWrap,
      margin: isDecided && isShown ? 0 : SHOW_MARGIN,
    });
    setFit((current) => (current?.name === name && current.isShown === next ? current : { name, isShown: next }));
  }, [triggerRef, name, mayWrap, isDecided, isShown]);

  useLayoutEffect(() => {
    measure();

    const parts = name === null ? null : findFooterParts(triggerRef.current);
    if (!parts || typeof ResizeObserver === 'undefined') {
      return;
    }

    // The footer changes width with the window, the sidebar and a docked
    // editor; the tools when the clear button appears; the controls when the
    // model or the name changes.
    const observer = new ResizeObserver(() => measure());
    observer.observe(parts.footer);
    observer.observe(parts.tools);
    observer.observe(parts.controls);
    return () => observer.disconnect();
  }, [measure, name, triggerRef]);

  return isShown;
}
