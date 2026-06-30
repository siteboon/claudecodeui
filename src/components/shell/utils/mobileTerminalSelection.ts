import type { IDisposable, Terminal } from '@xterm/xterm';

import { copyTextToClipboard } from '../../../utils/clipboard';

type TerminalCoords = {
  col: number;
  row: number;
};

type TouchCoords = {
  clientX: number;
  clientY: number;
};

type CellDimensions = {
  width: number;
  height: number;
};

type DragHandle = 'start' | 'end';

type TerminalWithRenderService = Terminal & {
  _core?: {
    _renderService?: {
      dimensions?: {
        css?: {
          cell?: {
            width?: number;
            height?: number;
          };
        };
      };
    };
  };
};

export type MobileTerminalSelectionManager = {
  dispose: () => void;
  updateHandles: () => void;
};

const LONG_PRESS_MS = 600;
const MOVE_THRESHOLD_PX = 8;
const HANDLE_SIZE_PX = 22;
const FINGER_OFFSET_PX = 40;
const CONTEXT_MENU_GAP_PX = 12;
const CONTEXT_MENU_EDGE_PADDING_PX = 8;
const ZOOM_THROTTLE_MS = 50;
const DEFAULT_MIN_FONT_SIZE = 8;
const DEFAULT_MAX_FONT_SIZE = 48;
// xterm scrolls the viewport 1:1 with the finger and never coasts, so we add
// our own inertial (fling) scrolling: track finger velocity during the drag and
// keep scrolling with friction after release.
const SCROLL_INERTIA_FRICTION = 0.95; // velocity multiplier per ~16ms frame
const SCROLL_INERTIA_MIN_VELOCITY = 0.02; // px/ms below which coasting stops
const SCROLL_INERTIA_MAX_VELOCITY = 5; // px/ms cap to avoid runaway flings
const SCROLL_INERTIA_MAX_IDLE_MS = 90; // ignore a flick if the finger paused before lifting

type ContextMenuItem = {
  label: string;
  action: () => void;
};

export type MobileTerminalSelectionOptions = {
  minFontSize?: number;
  maxFontSize?: number;
  onFontSizeChange?: (fontSize: number) => void;
};

function isTouchSelectionEnvironment(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  return (
    navigator.maxTouchPoints > 0 ||
    'ontouchstart' in window ||
    window.matchMedia?.('(pointer: coarse)').matches === true
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getDistance(start: TouchCoords, end: TouchCoords): number {
  return Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY);
}

class ShellMobileSelectionCore implements MobileTerminalSelectionManager {
  private readonly terminal: Terminal;
  private readonly terminalContent: HTMLElement;
  private readonly overlay: HTMLDivElement;
  private readonly startHandle: HTMLDivElement;
  private readonly endHandle: HTMLDivElement;
  private readonly contextMenu: HTMLDivElement;
  private readonly disposables: IDisposable[] = [];
  private readonly originalPosition: string;

  private didSetPosition = false;
  private isDestroyed = false;
  private isSelecting = false;
  private isHandleDragging = false;
  private dragHandle: DragHandle | null = null;
  private selectionStart: TerminalCoords | null = null;
  private selectionEnd: TerminalCoords | null = null;
  private touchStart: TouchCoords | null = null;
  private pendingClearTouch: { point: TouchCoords; moved: boolean } | null = null;
  private tapHoldTimeout: number | null = null;
  private cellDimensions: CellDimensions = { width: 0, height: 0 };
  private isContextMenuVisible = false;

  private readonly minFontSize: number;
  private readonly maxFontSize: number;
  private readonly onFontSizeChange: (fontSize: number) => void;
  private isPinching = false;
  private pinchStartDistance = 0;
  private initialFontSize = 0;
  private lastZoomTime = 0;

  private viewportElement: HTMLElement | null = null;
  private lastScrollTouchY: number | null = null;
  private lastScrollTouchTime = 0;
  private scrollVelocity = 0;
  private inertiaFrame: number | null = null;

  constructor(
    terminal: Terminal,
    terminalContent: HTMLElement,
    options: MobileTerminalSelectionOptions = {},
  ) {
    this.terminal = terminal;
    this.terminalContent = terminalContent;
    this.originalPosition = terminalContent.style.position;

    const minFontSize = Number(options.minFontSize) || DEFAULT_MIN_FONT_SIZE;
    const maxFontSize = Number(options.maxFontSize) || DEFAULT_MAX_FONT_SIZE;
    this.minFontSize = Math.min(minFontSize, maxFontSize);
    this.maxFontSize = Math.max(minFontSize, maxFontSize);
    this.onFontSizeChange =
      options.onFontSizeChange ??
      ((fontSize) => {
        this.terminal.options.fontSize = fontSize;
        this.terminal.refresh(0, this.terminal.rows - 1);
      });

    if (window.getComputedStyle(terminalContent).position === 'static') {
      terminalContent.style.position = 'relative';
      this.didSetPosition = true;
    }

    this.overlay = this.createSelectionOverlay();
    this.startHandle = this.createHandle('start');
    this.endHandle = this.createHandle('end');
    this.contextMenu = this.createContextMenu();
    this.overlay.append(this.startHandle, this.endHandle, this.contextMenu);
    this.terminalContent.appendChild(this.overlay);

    this.attachEventListeners();
    this.updateCellDimensions();
  }

  private createSelectionOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.className = 'shell-mobile-selection-overlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.overflow = 'hidden';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '30';
    return overlay;
  }

  private createHandle(type: DragHandle): HTMLDivElement {
    const handle = document.createElement('div');
    handle.className = `shell-mobile-selection-handle shell-mobile-selection-handle-${type}`;
    handle.dataset.handleType = type;
    handle.style.position = 'absolute';
    handle.style.width = `${HANDLE_SIZE_PX}px`;
    handle.style.height = `${HANDLE_SIZE_PX}px`;
    handle.style.borderRadius = '50%';
    handle.style.background = '#3b82f6';
    handle.style.border = '2px solid #fff';
    handle.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    handle.style.display = 'none';
    handle.style.pointerEvents = 'auto';
    handle.style.touchAction = 'none';
    handle.style.zIndex = '31';
    return handle;
  }

  private createContextMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    menu.className = 'shell-mobile-selection-menu';
    menu.style.position = 'absolute';
    menu.style.display = 'none';
    menu.style.alignItems = 'stretch';
    menu.style.padding = '4px';
    menu.style.gap = '2px';
    menu.style.background = '#1f2937';
    menu.style.border = '1px solid rgba(255,255,255,0.12)';
    menu.style.borderRadius = '10px';
    menu.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
    menu.style.pointerEvents = 'auto';
    menu.style.touchAction = 'none';
    menu.style.zIndex = '32';
    menu.style.whiteSpace = 'nowrap';
    menu.style.userSelect = 'none';

    const items: ContextMenuItem[] = [
      { label: 'Copy', action: () => this.copySelection() },
      { label: 'Select All', action: () => this.selectAllText() },
    ];

    for (const item of items) {
      menu.appendChild(this.createContextMenuButton(item));
    }

    return menu;
  }

  private createContextMenuButton(item: ContextMenuItem): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    button.style.appearance = 'none';
    button.style.border = 'none';
    button.style.margin = '0';
    button.style.padding = '8px 14px';
    button.style.background = 'transparent';
    button.style.color = '#f9fafb';
    button.style.fontSize = '14px';
    button.style.fontFamily = 'inherit';
    button.style.lineHeight = '1';
    button.style.borderRadius = '6px';
    button.style.cursor = 'pointer';
    button.style.pointerEvents = 'auto';
    button.style.touchAction = 'none';

    let actionExecuted = false;
    const arm = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      actionExecuted = false;
    };
    const run = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      if (actionExecuted) {
        return;
      }
      actionExecuted = true;
      item.action();
    };

    button.addEventListener('touchstart', arm, { passive: false });
    button.addEventListener('touchend', run, { passive: false });
    button.addEventListener('mousedown', arm);
    button.addEventListener('mouseup', run);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    return button;
  }

  private attachEventListeners(): void {
    if (!this.terminal.element) {
      return;
    }

    this.terminal.element.addEventListener('touchstart', this.onTerminalTouchStart, {
      passive: false,
    });
    this.terminal.element.addEventListener('touchmove', this.onTerminalTouchMove, {
      passive: false,
    });
    this.terminal.element.addEventListener('touchend', this.onTerminalTouchEnd, {
      passive: false,
    });
    this.terminal.element.addEventListener('touchcancel', this.onTerminalTouchCancel, {
      passive: false,
    });

    this.startHandle.addEventListener('touchstart', this.onHandleTouchStart, { passive: false });
    this.startHandle.addEventListener('touchmove', this.onHandleTouchMove, { passive: false });
    this.startHandle.addEventListener('touchend', this.onHandleTouchEnd, { passive: false });
    this.startHandle.addEventListener('touchcancel', this.onHandleTouchEnd, { passive: false });

    this.endHandle.addEventListener('touchstart', this.onHandleTouchStart, { passive: false });
    this.endHandle.addEventListener('touchmove', this.onHandleTouchMove, { passive: false });
    this.endHandle.addEventListener('touchend', this.onHandleTouchEnd, { passive: false });
    this.endHandle.addEventListener('touchcancel', this.onHandleTouchEnd, { passive: false });

    document.addEventListener('touchstart', this.onDocumentTouchStart, { passive: true });

    this.disposables.push(
      this.terminal.onSelectionChange(this.onSelectionChange),
      this.terminal.onResize(this.onTerminalResize),
      this.terminal.onScroll(this.onTerminalScroll),
    );
  }

  private onTerminalTouchStart = (event: TouchEvent): void => {
    this.cancelInertia();
    this.resetScrollTracking();

    if (event.touches.length === 2) {
      event.preventDefault();
      this.startPinchZoom(event);
      return;
    }

    if (event.touches.length !== 1) {
      this.clearTapHoldTimeout();
      return;
    }

    const touch = this.toTouchCoords(event.touches[0]);
    this.touchStart = touch;

    if (this.isSelecting) {
      this.pendingClearTouch = { point: touch, moved: false };
      return;
    }

    this.clearTapHoldTimeout();
    this.tapHoldTimeout = window.setTimeout(() => {
      this.tapHoldTimeout = null;
      this.startSelection(touch);
    }, LONG_PRESS_MS);
  };

  private onTerminalTouchMove = (event: TouchEvent): void => {
    if (event.touches.length === 2 && this.isPinching) {
      event.preventDefault();
      this.handlePinchZoom(event);
      return;
    }

    if (event.touches.length !== 1) {
      this.clearTapHoldTimeout();
      return;
    }

    if (this.isPinching) {
      return;
    }

    const touch = this.toTouchCoords(event.touches[0]);
    const touchStart = this.touchStart;

    if (this.pendingClearTouch) {
      this.pendingClearTouch.moved =
        this.pendingClearTouch.moved ||
        getDistance(this.pendingClearTouch.point, touch) > MOVE_THRESHOLD_PX;
      return;
    }

    if (!touchStart) {
      return;
    }

    const moved = getDistance(touchStart, touch) > MOVE_THRESHOLD_PX;
    if (moved) {
      this.clearTapHoldTimeout();
    }

    if (this.isSelecting && !this.isHandleDragging) {
      event.preventDefault();
      this.extendSelection(touch);
      return;
    }

    // Plain one-finger scrolling: xterm moves the viewport itself; we only
    // record the finger velocity so we can add inertia when the touch ends.
    this.recordScrollSample(touch);
  };

  private onTerminalTouchEnd = (event: TouchEvent): void => {
    if (this.isPinching) {
      this.endPinchZoom();
      return;
    }

    this.clearTapHoldTimeout();
    this.touchStart = null;

    // A long-press selection (or a tap dismissing one) must not let the browser
    // synthesize the mouse click that refocuses xterm's hidden textarea — that
    // is what pops up the mobile keyboard. A plain tap leaves isSelecting false
    // and falls through, so it still focuses the terminal and shows the keyboard.
    if (this.isSelecting || this.isHandleDragging) {
      event.preventDefault();
      this.blurTerminalInput();
    }

    if (!this.pendingClearTouch) {
      this.maybeStartInertia();
      return;
    }

    const shouldClear = this.isSelecting && !this.pendingClearTouch.moved && !this.isHandleDragging;
    this.pendingClearTouch = null;

    if (shouldClear) {
      this.clearSelection();
    }
  };

  private onTerminalTouchCancel = (): void => {
    if (this.isPinching) {
      this.endPinchZoom();
    }

    this.clearTapHoldTimeout();
    this.touchStart = null;
    this.pendingClearTouch = null;
  };

  private onHandleTouchStart = (event: TouchEvent): void => {
    event.preventDefault();
    event.stopPropagation();

    if (event.touches.length !== 1) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    this.dragHandle = target.dataset.handleType === 'start' ? 'start' : 'end';
    this.isHandleDragging = true;
    this.pendingClearTouch = null;
  };

  private onHandleTouchMove = (event: TouchEvent): void => {
    if (!this.isHandleDragging || !this.dragHandle || event.touches.length !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const touch = this.toTouchCoords(event.touches[0]);
    const adjustedTouch = {
      clientX: touch.clientX,
      clientY: touch.clientY - FINGER_OFFSET_PX,
    };
    const coords = this.touchToTerminalCoords(adjustedTouch);
    if (!coords) {
      return;
    }

    if (this.dragHandle === 'start') {
      this.selectionStart = coords;
    } else {
      this.selectionEnd = coords;
    }

    this.swapHandlesIfNeeded();
    this.updateSelection();
  };

  private onHandleTouchEnd = (event: TouchEvent): void => {
    if (!this.isHandleDragging) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.isHandleDragging = false;
    this.dragHandle = null;
  };

  private onSelectionChange = (): void => {
    if (!this.isSelecting) {
      return;
    }

    if (!this.terminal.hasSelection()) {
      this.resetSelectionState();
      return;
    }

    this.updateHandles();
  };

  private onTerminalResize = (): void => {
    this.updateCellDimensions();
    this.updateHandles();
  };

  private onTerminalScroll = (): void => {
    this.updateHandles();
  };

  private onDocumentTouchStart = (event: TouchEvent): void => {
    if (!this.isSelecting || !event.target) {
      return;
    }

    if (this.terminalContent.contains(event.target as Node)) {
      return;
    }

    this.clearSelection();
  };

  private startSelection(touch: TouchCoords): void {
    const coords = this.touchToTerminalCoords(touch);
    if (!coords) {
      return;
    }

    const wordBounds = this.getWordBoundsAt(coords);
    this.selectionStart = wordBounds?.start ?? coords;
    this.selectionEnd = wordBounds?.end ?? coords;
    this.isSelecting = true;

    // Dismiss the mobile keyboard if it was open: selecting text is not typing.
    this.blurTerminalInput();

    this.updateSelection();
    this.showHandles();
    this.showContextMenu();
  }

  private extendSelection(touch: TouchCoords): void {
    const coords = this.touchToTerminalCoords(touch);
    if (!coords) {
      return;
    }

    this.selectionEnd = coords;
    this.updateSelection();
  }

  private updateSelection(): void {
    if (!this.selectionStart || !this.selectionEnd) {
      return;
    }

    const { start, end } = this.getOrderedSelection();
    const length = this.calculateSelectionLength(start, end);
    if (length <= 0) {
      return;
    }

    this.terminal.select(start.col, start.row, length);
    this.updateHandles();
  }

  private calculateSelectionLength(start: TerminalCoords, end: TerminalCoords): number {
    if (start.row === end.row) {
      return end.col - start.col + 1;
    }

    return (end.row - start.row) * this.terminal.cols - start.col + end.col + 1;
  }

  private getOrderedSelection(): { start: TerminalCoords; end: TerminalCoords } {
    const start = this.selectionStart;
    const end = this.selectionEnd;
    if (!start || !end) {
      throw new Error('Cannot order empty terminal selection');
    }

    if (start.row < end.row || (start.row === end.row && start.col <= end.col)) {
      return { start, end };
    }

    return { start: end, end: start };
  }

  private swapHandlesIfNeeded(): void {
    if (!this.selectionStart || !this.selectionEnd || !this.dragHandle) {
      return;
    }

    const { start, end } = this.getOrderedSelection();
    if (start === this.selectionStart && end === this.selectionEnd) {
      return;
    }

    this.selectionStart = start;
    this.selectionEnd = end;
    this.dragHandle = this.dragHandle === 'start' ? 'end' : 'start';
  }

  private showHandles(): void {
    this.startHandle.style.display = 'block';
    this.endHandle.style.display = 'block';
    this.updateHandles();
  }

  private hideHandles(): void {
    this.startHandle.style.display = 'none';
    this.endHandle.style.display = 'none';
  }

  private showContextMenu(): void {
    this.contextMenu.style.display = 'flex';
    this.isContextMenuVisible = true;
    this.positionContextMenu();
  }

  private hideContextMenu(): void {
    this.contextMenu.style.display = 'none';
    this.isContextMenuVisible = false;
  }

  private positionContextMenu(): void {
    if (!this.isContextMenuVisible) {
      return;
    }

    const containerRect = this.terminalContent.getBoundingClientRect();
    const menuWidth = this.contextMenu.offsetWidth || 0;
    const menuHeight = this.contextMenu.offsetHeight || 0;

    const ordered =
      this.selectionStart && this.selectionEnd ? this.getOrderedSelection() : null;
    const startPosition = ordered ? this.terminalCoordsToPixels(ordered.start) : null;
    const endPosition = ordered ? this.terminalCoordsToPixels(ordered.end) : null;

    let menuX: number;
    let menuY: number;

    if (startPosition || endPosition) {
      const topY = Math.min(
        startPosition?.y ?? endPosition!.y,
        endPosition?.y ?? startPosition!.y,
      );
      const centerX =
        startPosition && endPosition
          ? (startPosition.x + endPosition.x) / 2
          : (startPosition ?? endPosition)!.x;

      menuX = centerX - menuWidth / 2;
      menuY = topY - menuHeight - CONTEXT_MENU_GAP_PX;

      // Not enough room above the selection: drop below the handles instead.
      if (menuY < CONTEXT_MENU_EDGE_PADDING_PX) {
        const bottomY = Math.max(
          startPosition?.y ?? endPosition!.y,
          endPosition?.y ?? startPosition!.y,
        );
        menuY = bottomY + this.cellDimensions.height + HANDLE_SIZE_PX + CONTEXT_MENU_GAP_PX;
      }
    } else {
      // Whole-buffer selection (Select All): pin to the bottom center.
      menuX = (containerRect.width - menuWidth) / 2;
      menuY = containerRect.height - menuHeight - CONTEXT_MENU_GAP_PX;
    }

    const maxX = containerRect.width - menuWidth - CONTEXT_MENU_EDGE_PADDING_PX;
    const maxY = containerRect.height - menuHeight - CONTEXT_MENU_EDGE_PADDING_PX;
    menuX = clamp(menuX, CONTEXT_MENU_EDGE_PADDING_PX, Math.max(CONTEXT_MENU_EDGE_PADDING_PX, maxX));
    menuY = clamp(menuY, CONTEXT_MENU_EDGE_PADDING_PX, Math.max(CONTEXT_MENU_EDGE_PADDING_PX, maxY));

    this.contextMenu.style.left = `${menuX}px`;
    this.contextMenu.style.top = `${menuY}px`;
  }

  private copySelection(): void {
    const selectionText = this.terminal.getSelection();
    if (selectionText) {
      void copyTextToClipboard(selectionText);
    }
    this.clearSelection();
  }

  private selectAllText(): void {
    this.terminal.selectAll();
    this.selectionStart = null;
    this.selectionEnd = null;
    this.isSelecting = true;
    this.hideHandles();

    if (this.terminal.hasSelection()) {
      this.showContextMenu();
    } else {
      this.clearSelection();
    }
  }

  private startPinchZoom(event: TouchEvent): void {
    if (event.touches.length !== 2) {
      return;
    }

    this.clearTapHoldTimeout();
    if (this.isSelecting) {
      this.clearSelection();
    }

    this.isPinching = true;
    this.initialFontSize = this.terminal.options.fontSize ?? DEFAULT_MIN_FONT_SIZE;
    this.pinchStartDistance = this.getTouchDistance(event.touches[0], event.touches[1]);
    this.lastZoomTime = 0;
  }

  private handlePinchZoom(event: TouchEvent): void {
    if (!this.isPinching || event.touches.length !== 2 || this.pinchStartDistance <= 0) {
      return;
    }

    const now = Date.now();
    if (now - this.lastZoomTime < ZOOM_THROTTLE_MS) {
      return;
    }
    this.lastZoomTime = now;

    const currentDistance = this.getTouchDistance(event.touches[0], event.touches[1]);
    const scale = currentDistance / this.pinchStartDistance;
    const nextFontSize = clamp(
      Math.round(this.initialFontSize * scale),
      this.minFontSize,
      this.maxFontSize,
    );

    if (nextFontSize !== this.terminal.options.fontSize) {
      this.onFontSizeChange(nextFontSize);
    }
  }

  private endPinchZoom(): void {
    this.isPinching = false;
    this.pinchStartDistance = 0;
    this.initialFontSize = 0;
  }

  private getTouchDistance(first: Touch, second: Touch): number {
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  }

  private getViewportElement(): HTMLElement | null {
    if (this.viewportElement?.isConnected) {
      return this.viewportElement;
    }

    this.viewportElement =
      this.terminal.element?.querySelector<HTMLElement>('.xterm-viewport') ?? null;
    return this.viewportElement;
  }

  private resetScrollTracking(): void {
    this.lastScrollTouchY = null;
    this.lastScrollTouchTime = 0;
    this.scrollVelocity = 0;
  }

  private recordScrollSample(touch: TouchCoords): void {
    const now = performance.now();

    if (this.lastScrollTouchY !== null) {
      const dt = now - this.lastScrollTouchTime;
      if (dt > 0) {
        // Positive when the finger moves up, matching how xterm increases
        // scrollTop, so the inertia continues in the same direction.
        const velocity = (this.lastScrollTouchY - touch.clientY) / dt;
        this.scrollVelocity = this.scrollVelocity * 0.4 + velocity * 0.6;
      }
    }

    this.lastScrollTouchY = touch.clientY;
    this.lastScrollTouchTime = now;
  }

  private maybeStartInertia(): void {
    if (this.isSelecting || this.isHandleDragging || this.isPinching) {
      return;
    }

    const idle = performance.now() - this.lastScrollTouchTime;
    if (idle > SCROLL_INERTIA_MAX_IDLE_MS) {
      return;
    }

    if (Math.abs(this.scrollVelocity) < SCROLL_INERTIA_MIN_VELOCITY) {
      return;
    }

    this.startInertia(this.scrollVelocity);
  }

  private startInertia(initialVelocity: number): void {
    const viewport = this.getViewportElement();
    if (!viewport) {
      return;
    }

    this.cancelInertia();

    let velocity = clamp(
      initialVelocity,
      -SCROLL_INERTIA_MAX_VELOCITY,
      SCROLL_INERTIA_MAX_VELOCITY,
    );
    let lastFrame = performance.now();

    const step = (now: number): void => {
      const dt = Math.max(1, now - lastFrame);
      lastFrame = now;
      velocity *= Math.pow(SCROLL_INERTIA_FRICTION, dt / 16);

      if (Math.abs(velocity) < SCROLL_INERTIA_MIN_VELOCITY) {
        this.inertiaFrame = null;
        return;
      }

      const before = viewport.scrollTop;
      viewport.scrollTop = before + velocity * dt;
      if (viewport.scrollTop === before) {
        // Reached the top or bottom of the buffer.
        this.inertiaFrame = null;
        return;
      }

      this.inertiaFrame = window.requestAnimationFrame(step);
    };

    this.inertiaFrame = window.requestAnimationFrame(step);
  }

  private cancelInertia(): void {
    if (this.inertiaFrame !== null) {
      window.cancelAnimationFrame(this.inertiaFrame);
      this.inertiaFrame = null;
    }
  }

  updateHandles(): void {
    if (this.isContextMenuVisible) {
      this.positionContextMenu();
    }

    if (!this.isSelecting || !this.selectionStart || !this.selectionEnd) {
      this.hideHandles();
      return;
    }

    const { start, end } = this.getOrderedSelection();
    const startPosition = this.terminalCoordsToPixels(start);
    const endPosition = this.terminalCoordsToPixels(end);

    // Keep the full handle inside the overlay (which clips via overflow:hidden)
    // so a selection that begins at column 0 doesn't leave the handle clipped
    // off the left edge where it can't be tapped.
    const maxHandleLeft = Math.max(0, this.terminalContent.clientWidth - HANDLE_SIZE_PX);

    if (startPosition) {
      this.startHandle.style.display = 'block';
      this.startHandle.style.left = `${clamp(startPosition.x - HANDLE_SIZE_PX / 2, 0, maxHandleLeft)}px`;
      this.startHandle.style.top = `${startPosition.y + this.cellDimensions.height + 4}px`;
    } else {
      this.startHandle.style.display = 'none';
    }

    if (endPosition) {
      this.endHandle.style.display = 'block';
      this.endHandle.style.left = `${clamp(endPosition.x + this.cellDimensions.width - HANDLE_SIZE_PX / 2, 0, maxHandleLeft)}px`;
      this.endHandle.style.top = `${endPosition.y + this.cellDimensions.height + 4}px`;
    } else {
      this.endHandle.style.display = 'none';
    }
  }

  private clearSelection(): void {
    this.terminal.clearSelection();
    this.resetSelectionState();
  }

  private resetSelectionState(): void {
    this.isSelecting = false;
    this.isHandleDragging = false;
    this.dragHandle = null;
    this.selectionStart = null;
    this.selectionEnd = null;
    this.pendingClearTouch = null;
    this.touchStart = null;
    this.hideHandles();
    this.hideContextMenu();
    this.clearTapHoldTimeout();
  }

  private touchToTerminalCoords(touch: TouchCoords): TerminalCoords | null {
    const screenElement = this.getTerminalScreenElement();
    if (!screenElement) {
      return null;
    }

    const rect = screenElement.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return null;
    }

    this.updateCellDimensions();
    if (!this.cellDimensions.width || !this.cellDimensions.height) {
      return null;
    }

    const col = clamp(Math.floor(x / this.cellDimensions.width), 0, this.terminal.cols - 1);
    const row = Math.floor(y / this.cellDimensions.height) + this.terminal.buffer.active.viewportY;

    return {
      col,
      row: Math.max(0, row),
    };
  }

  private terminalCoordsToPixels(coords: TerminalCoords): { x: number; y: number } | null {
    const screenElement = this.getTerminalScreenElement();
    if (!screenElement) {
      return null;
    }

    this.updateCellDimensions();

    const visibleRow = coords.row - this.terminal.buffer.active.viewportY;
    if (visibleRow < 0 || visibleRow >= this.terminal.rows) {
      return null;
    }

    const screenRect = screenElement.getBoundingClientRect();
    const containerRect = this.terminalContent.getBoundingClientRect();

    return {
      x: screenRect.left - containerRect.left + coords.col * this.cellDimensions.width,
      y: screenRect.top - containerRect.top + visibleRow * this.cellDimensions.height,
    };
  }

  private updateCellDimensions(): void {
    const renderCell = (this.terminal as TerminalWithRenderService)._core?._renderService
      ?.dimensions?.css?.cell;
    if (renderCell?.width && renderCell.height) {
      this.cellDimensions = {
        width: renderCell.width,
        height: renderCell.height,
      };
      return;
    }

    const screenElement = this.getTerminalScreenElement();
    const rect = screenElement?.getBoundingClientRect();
    if (!rect || !this.terminal.cols || !this.terminal.rows) {
      this.cellDimensions = { width: 0, height: 0 };
      return;
    }

    this.cellDimensions = {
      width: rect.width / this.terminal.cols,
      height: rect.height / this.terminal.rows,
    };
  }

  private getWordBoundsAt(coords: TerminalCoords): {
    start: TerminalCoords;
    end: TerminalCoords;
  } | null {
    const line = this.terminal.buffer.active.getLine(coords.row);
    if (!line) {
      return null;
    }

    const lineText = line.translateToString(false);
    if (!lineText || coords.col >= lineText.length || /\s/.test(lineText[coords.col])) {
      return null;
    }

    let startCol = coords.col;
    let endCol = coords.col;

    while (startCol > 0 && !/\s/.test(lineText[startCol - 1])) {
      startCol--;
    }

    while (endCol < lineText.length - 1 && !/\s/.test(lineText[endCol + 1])) {
      endCol++;
    }

    return {
      start: { row: coords.row, col: startCol },
      end: { row: coords.row, col: endCol },
    };
  }

  private blurTerminalInput(): void {
    const textarea = this.terminal.element?.querySelector<HTMLTextAreaElement>(
      '.xterm-helper-textarea',
    );
    textarea?.blur();
  }

  private getTerminalScreenElement(): HTMLElement | null {
    return (
      this.terminal.element?.querySelector<HTMLElement>('.xterm-screen') ??
      this.terminal.element ??
      null
    );
  }

  private toTouchCoords(touch: Touch): TouchCoords {
    return {
      clientX: touch.clientX,
      clientY: touch.clientY,
    };
  }

  private clearTapHoldTimeout(): void {
    if (this.tapHoldTimeout === null) {
      return;
    }

    window.clearTimeout(this.tapHoldTimeout);
    this.tapHoldTimeout = null;
  }

  dispose(): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    this.clearTapHoldTimeout();
    this.cancelInertia();

    this.terminal.element?.removeEventListener('touchstart', this.onTerminalTouchStart);
    this.terminal.element?.removeEventListener('touchmove', this.onTerminalTouchMove);
    this.terminal.element?.removeEventListener('touchend', this.onTerminalTouchEnd);
    this.terminal.element?.removeEventListener('touchcancel', this.onTerminalTouchCancel);

    this.startHandle.removeEventListener('touchstart', this.onHandleTouchStart);
    this.startHandle.removeEventListener('touchmove', this.onHandleTouchMove);
    this.startHandle.removeEventListener('touchend', this.onHandleTouchEnd);
    this.startHandle.removeEventListener('touchcancel', this.onHandleTouchEnd);

    this.endHandle.removeEventListener('touchstart', this.onHandleTouchStart);
    this.endHandle.removeEventListener('touchmove', this.onHandleTouchMove);
    this.endHandle.removeEventListener('touchend', this.onHandleTouchEnd);
    this.endHandle.removeEventListener('touchcancel', this.onHandleTouchEnd);

    document.removeEventListener('touchstart', this.onDocumentTouchStart);
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;

    this.overlay.remove();

    if (this.didSetPosition) {
      this.terminalContent.style.position = this.originalPosition;
    }
  }
}

export function installMobileTerminalSelection(
  terminal: Terminal,
  terminalContent: HTMLElement,
  options: MobileTerminalSelectionOptions = {},
): MobileTerminalSelectionManager | null {
  if (!isTouchSelectionEnvironment() || !terminal.element) {
    return null;
  }

  return new ShellMobileSelectionCore(terminal, terminalContent, options);
}
