import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import {
  DEFAULT_HANDLE_POSITION,
  DRAG_THRESHOLD_PX,
  HANDLE_POSITION_MAX,
  HANDLE_POSITION_MIN,
  HANDLE_POSITION_STORAGE_KEY,
} from '../constants';
import type { QuickSettingsHandleStyle } from '../types';

type UseQuickSettingsDragProps = {
  isMobile: boolean;
};

type StartDragEvent = ReactMouseEvent<HTMLButtonElement> | ReactTouchEvent<HTMLButtonElement>;
type MoveDragEvent = MouseEvent | TouchEvent;
type EventWithClientY = StartDragEvent | MoveDragEvent;

const clampPosition = (value: number): number => (
  Math.max(HANDLE_POSITION_MIN, Math.min(HANDLE_POSITION_MAX, value))
);

const readHandlePosition = (): number => {
  if (typeof window === 'undefined') {
    return DEFAULT_HANDLE_POSITION;
  }

  const saved = localStorage.getItem(HANDLE_POSITION_STORAGE_KEY);
  if (!saved) {
    return DEFAULT_HANDLE_POSITION;
  }

  try {
    const parsed = JSON.parse(saved) as { y?: unknown };
    if (typeof parsed.y === 'number' && Number.isFinite(parsed.y)) {
      return clampPosition(parsed.y);
    }
  } catch {
    localStorage.removeItem(HANDLE_POSITION_STORAGE_KEY);
    return DEFAULT_HANDLE_POSITION;
  }

  return DEFAULT_HANDLE_POSITION;
};

const isTouchEvent = (event: { type: string }): boolean => event.type.includes('touch');

const getClientY = (event: EventWithClientY): number | null => {
  if ('touches' in event) {
    return event.touches[0]?.clientY ?? null;
  }

  return 'clientY' in event && typeof event.clientY === 'number'
    ? event.clientY
    : null;
};

export function useQuickSettingsDrag({ isMobile }: UseQuickSettingsDragProps) {
  const [handlePosition, setHandlePosition] = useState<number>(readHandlePosition);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartYRef = useRef<number | null>(null);
  const dragStartPositionRef = useRef(DEFAULT_HANDLE_POSITION);
  const didDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const bodyStylesAppliedRef = useRef(false);

  const clearBodyDragStyles = useCallback(() => {
    if (!bodyStylesAppliedRef.current) {
      return;
    }

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    bodyStylesAppliedRef.current = false;
  }, []);

  const applyBodyDragStyles = useCallback((isTouchDragging: boolean) => {
    if (bodyStylesAppliedRef.current) {
      return;
    }

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    // Touch drag should lock body scroll so the handle movement stays smooth.
    if (isTouchDragging) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    }

    bodyStylesAppliedRef.current = true;
  }, []);

  const endDrag = useCallback(() => {
    if (!isPointerDown && dragStartYRef.current === null) {
      return;
    }

    suppressNextClickRef.current = didDragRef.current;
    didDragRef.current = false;
    dragStartYRef.current = null;
    setIsPointerDown(false);
    setIsDragging(false);
    clearBodyDragStyles();
  }, [clearBodyDragStyles, isPointerDown]);

  const handleMove = useCallback(
    (event: MoveDragEvent) => {
      if (!isPointerDown || dragStartYRef.current === null) {
        return;
      }

      const clientY = getClientY(event);
      if (clientY === null) {
        return;
      }

      const rawDelta = clientY - dragStartYRef.current;
      const movedPastThreshold = Math.abs(rawDelta) > DRAG_THRESHOLD_PX;

      if (!didDragRef.current && movedPastThreshold) {
        didDragRef.current = true;
        setIsDragging(true);
        applyBodyDragStyles(isTouchEvent(event));
      }

      if (!didDragRef.current) {
        return;
      }

      if (isTouchEvent(event)) {
        event.preventDefault();
      }

      const viewportHeight = Math.max(window.innerHeight, 1);
      const normalizedDelta = (rawDelta / viewportHeight) * 100;
      const positionDelta = isMobile ? -normalizedDelta : normalizedDelta;
      setHandlePosition(clampPosition(dragStartPositionRef.current + positionDelta));
    },
    [applyBodyDragStyles, isMobile, isPointerDown],
  );

  const startDrag = useCallback((event: StartDragEvent) => {
    event.stopPropagation();

    const clientY = getClientY(event);
    if (clientY === null) {
      return;
    }

    dragStartYRef.current = clientY;
    dragStartPositionRef.current = handlePosition;
    didDragRef.current = false;
    setIsDragging(false);
    setIsPointerDown(true);
  }, [handlePosition]);

  // Persist drag-handle position so users keep their preferred quick-access location.
  useEffect(() => {
    localStorage.setItem(
      HANDLE_POSITION_STORAGE_KEY,
      JSON.stringify({ y: handlePosition }),
    );
  }, [handlePosition]);

  useEffect(() => {
    if (!isPointerDown) {
      return undefined;
    }

    const handleMouseMove = (event: MouseEvent) => {
      handleMove(event);
    };
    const handleMouseUp = () => {
      endDrag();
    };
    const handleTouchMove = (event: TouchEvent) => {
      handleMove(event);
    };
    const handleTouchEnd = () => {
      endDrag();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [endDrag, handleMove, isPointerDown]);

  useEffect(() => (
    () => {
      clearBodyDragStyles();
    }
  ), [clearBodyDragStyles]);

  const consumeSuppressedClick = useCallback((): boolean => {
    if (!suppressNextClickRef.current) {
      return false;
    }

    suppressNextClickRef.current = false;
    return true;
  }, []);

  const handleStyle = useMemo<QuickSettingsHandleStyle>(() => {
    if (!isMobile || typeof window === 'undefined') {
      return {
        top: `${handlePosition}%`,
        transform: 'translateY(-50%)',
      };
    }

    return {
      bottom: `${(window.innerHeight * handlePosition) / 100}px`,
    };
  }, [handlePosition, isMobile]);

  return {
    isDragging,
    handleStyle,
    startDrag,
    endDrag,
    consumeSuppressedClick,
  };
}
