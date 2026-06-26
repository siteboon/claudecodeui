import type { IDisposable, Terminal } from '@xterm/xterm';

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

  constructor(terminal: Terminal, terminalContent: HTMLElement) {
    this.terminal = terminal;
    this.terminalContent = terminalContent;
    this.originalPosition = terminalContent.style.position;

    if (window.getComputedStyle(terminalContent).position === 'static') {
      terminalContent.style.position = 'relative';
      this.didSetPosition = true;
    }

    this.overlay = this.createSelectionOverlay();
    this.startHandle = this.createHandle('start');
    this.endHandle = this.createHandle('end');
    this.overlay.append(this.startHandle, this.endHandle);
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
    if (event.touches.length !== 1) {
      this.clearTapHoldTimeout();
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
    }
  };

  private onTerminalTouchEnd = (): void => {
    this.clearTapHoldTimeout();
    this.touchStart = null;

    if (!this.pendingClearTouch) {
      return;
    }

    const shouldClear = this.isSelecting && !this.pendingClearTouch.moved && !this.isHandleDragging;
    this.pendingClearTouch = null;

    if (shouldClear) {
      this.clearSelection();
    }
  };

  private onTerminalTouchCancel = (): void => {
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

    this.updateSelection();
    this.showHandles();
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

  updateHandles(): void {
    if (!this.isSelecting || !this.selectionStart || !this.selectionEnd) {
      this.hideHandles();
      return;
    }

    const { start, end } = this.getOrderedSelection();
    const startPosition = this.terminalCoordsToPixels(start);
    const endPosition = this.terminalCoordsToPixels(end);

    if (startPosition) {
      this.startHandle.style.display = 'block';
      this.startHandle.style.left = `${startPosition.x - HANDLE_SIZE_PX / 2}px`;
      this.startHandle.style.top = `${startPosition.y + this.cellDimensions.height + 4}px`;
    } else {
      this.startHandle.style.display = 'none';
    }

    if (endPosition) {
      this.endHandle.style.display = 'block';
      this.endHandle.style.left = `${endPosition.x + this.cellDimensions.width - HANDLE_SIZE_PX / 2}px`;
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
): MobileTerminalSelectionManager | null {
  if (!isTouchSelectionEnvironment() || !terminal.element) {
    return null;
  }

  return new ShellMobileSelectionCore(terminal, terminalContent);
}
