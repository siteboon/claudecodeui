import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson, ApiRequestError } from '@/shared/api';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';

type Point = { x: number; y: number };
type ScrollInput = { type: 'wheel'; dx: number; dy: number } & Point;
type LiveInput =
  | ({ type: 'pointer'; to?: Point } & Point)
  | ScrollInput
  | { type: 'text'; text: string }
  | { type: 'key'; key: string };

type BrowserControlViewProps = {
  sessionId: string;
  controlId: string;
  onClose: () => void;
  onLost: (controlId: string) => void;
  onReturned: (controlId: string) => void;
};

const REMOTE_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete',
  'Enter', 'Tab', 'Home', 'End', 'PageUp', 'PageDown',
]);

function pointAt(element: HTMLElement, x: number, y: number): Point {
  const rect = element.getBoundingClientRect();
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return { x: clamp((x - rect.left) / rect.width), y: clamp((y - rect.top) / rect.height) };
}

function scrollDelta(element: HTMLImageElement, dx: number, dy: number) {
  const { width, height } = element.getBoundingClientRect();
  return {
    dx: dx * ((element.naturalWidth && width) ? element.naturalWidth / width : 1),
    dy: dy * ((element.naturalHeight && height) ? element.naturalHeight / height : 1),
  };
}

/** Used by BrowserUsePanel to control an existing Chromium page inside the workspace. */
export default function BrowserControlView({ sessionId, controlId, onClose, onLost, onReturned }: BrowserControlViewProps) {
  const { t } = useTranslation('settings');
  // The private frame is kept only inside the live viewer.
  const [frame, setFrame] = useState<string | null>(null);
  // Keep transient input or preview errors visible while the viewer remains open.
  const [failed, setFailed] = useState(false);
  // Report backpressure rather than partially delivering a large paste.
  const [queueFull, setQueueFull] = useState(false);
  // Prevent duplicate hand-back requests while the server drains pending input.
  const [returning, setReturning] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const gesture = useRef<{ start: Point; last: Point; scrolling: boolean } | null>(null);
  const composing = useRef(false);
  const inputTail = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);
  const pendingScroll = useRef<ScrollInput | null>(null);
  const returningRef = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const hasFrame = frame !== null;

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        if (!document.hidden) {
          const response = await api.browserUse.control(sessionId, 'frame', { controlId }, { signal: controller.signal });
          const { data } = await readApiJson<{ data: { screenshotDataUrl: string | null } }>(response);
          if (!controller.signal.aborted && data.screenshotDataUrl) setFrame(data.screenshotDataUrl);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && error.code === 'BROWSER_USE_CONTROL_LOST') {
          onLost(controlId);
          return;
        }
        setFailed(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void update(), 250);
    };
    void update();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sessionId, controlId, onLost]);

  const send = useCallback((...inputs: LiveInput[]) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || returningRef.current) return false;
    if (queued.current + inputs.length > 32) {
      setQueueFull(true);
      return false;
    }
    // Do not merge scroll events across a queued click or key press.
    if (inputs.some((input) => input.type !== 'wheel')) pendingScroll.current = null;
    setQueueFull(false);
    queued.current += inputs.length;
    inputTail.current = inputTail.current.then(async () => {
      for (const input of inputs) {
        if (signal.aborted) return;
        if (pendingScroll.current === input) pendingScroll.current = null;
        await readApiJson(await api.browserUse.control(sessionId, 'input', { controlId, ...input }, { signal }));
      }
      if (!signal.aborted) setFailed(false);
    }).catch(() => {
      if (!signal.aborted) setFailed(true);
    }).finally(() => {
      queued.current -= inputs.length;
    });
    return true;
  }, [sessionId, controlId]);

  const queueScroll = useCallback((point: Point, dx: number, dy: number) => {
    if (returningRef.current || (!dx && !dy)) return;
    const clamp = (delta: number) => Math.max(-2_000, Math.min(2_000, delta));
    const pending = pendingScroll.current;
    if (pending) {
      // One pending batch follows the in-flight request, rather than a request per wheel event.
      Object.assign(pending, point, { dx: clamp(pending.dx + dx), dy: clamp(pending.dy + dy) });
    } else {
      const input: ScrollInput = { type: 'wheel', ...point, dx: clamp(dx), dy: clamp(dy) };
      if (send(input)) pendingScroll.current = input;
    }
  }, [send]);

  useEffect(() => {
    const element = image.current;
    if (!element || !hasFrame) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1;
      const { dx, dy } = scrollDelta(element, event.deltaX * scale, event.deltaY * scale);
      queueScroll(pointAt(element, event.clientX, event.clientY), dx, dy);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      pendingScroll.current = null;
    };
  }, [hasFrame, queueScroll]);

  const pointerDown = (event: PointerEvent<HTMLImageElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    gesture.current = {
      start: pointAt(event.currentTarget, event.clientX, event.clientY),
      last: { x: event.clientX, y: event.clientY },
      scrolling: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType !== 'touch') keyboard.current?.focus({ preventScroll: true });
  };

  const pointerMove = (event: PointerEvent<HTMLImageElement>) => {
    const active = gesture.current;
    if (!active || !event.isPrimary || event.pointerType !== 'touch') return;
    const dx = active.last.x - event.clientX;
    const dy = active.last.y - event.clientY;
    if (!active.scrolling && Math.hypot(dx, dy) < 8) return;
    active.scrolling = true;
    active.last = { x: event.clientX, y: event.clientY };
    const delta = scrollDelta(event.currentTarget, dx, dy);
    queueScroll(active.start, delta.dx, delta.dy);
  };

  const pointerUp = (event: PointerEvent<HTMLImageElement>) => {
    if (!event.isPrimary || !gesture.current) return;
    const { start, scrolling } = gesture.current;
    gesture.current = null;
    if (event.pointerType === 'touch') {
      if (!scrolling) {
        keyboard.current?.focus({ preventScroll: true });
        send({ type: 'pointer', ...start });
      }
      return;
    }
    const end = pointAt(event.currentTarget, event.clientX, event.clientY);
    const isDrag = Math.hypot(start.x - end.x, start.y - end.y) > 0.005;
    send({ type: 'pointer', ...start, ...(isDrag ? { to: end } : {}) });
  };

  const sendText = (element: HTMLTextAreaElement) => {
    if (!element.value) return;
    const characters = Array.from(element.value);
    if (characters.length > 32_000) {
      setQueueFull(true);
    } else {
      const chunks: LiveInput[] = [];
      for (let i = 0; i < characters.length; i += 1000) {
        chunks.push({ type: 'text', text: characters.slice(i, i + 1000).join('') });
      }
      send(...chunks);
    }
    element.value = '';
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || composing.current) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const shortcut = event.ctrlKey || event.altKey || event.metaKey;
    // Let paste populate the local input; only its committed text is forwarded.
    if ((event.ctrlKey || event.metaKey) && key === 'v' && !event.altKey) return;
    if (!REMOTE_KEYS.has(key) && !(shortcut && /^[a-z0-9]$/.test(key))) return;
    event.preventDefault();
    send({ type: 'key', key: [
      event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key,
    ].filter(Boolean).join('+') });
  };

  const returnControl = async () => {
    if (returningRef.current) return;
    returningRef.current = true;
    setReturning(true);
    try {
      await inputTail.current;
      await readApiJson(await api.browserUse.control(sessionId, 'release', { controlId }));
      onReturned(controlId);
    } catch {
      setFailed(true);
    } finally {
      returningRef.current = false;
      setReturning(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[96dvh] w-[98vw] max-w-none flex-col gap-2 overflow-hidden p-3 sm:p-4" aria-describedby="browser-control-hint" aria-labelledby="browser-control-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DialogTitle id="browser-control-title" className="not-sr-only text-sm font-semibold">{t('browserUse.liveControlTitle')}</DialogTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={!hasFrame} onClick={() => keyboard.current?.focus()}>{t('browserUse.liveControlKeyboard')}</Button>
            <Button size="sm" variant="outline" onClick={onClose}>{t('browserUse.close')}</Button>
            <Button size="sm" disabled={returning} onClick={() => void returnControl()}>{t('browserUse.returnControl')}</Button>
          </div>
        </div>
        <p id="browser-control-hint" className="text-sm text-muted-foreground">{t('browserUse.liveControlHint')}</p>
        {failed && <p role="alert" className="text-sm text-destructive">{t('browserUse.liveControlFailed')}</p>}
        {queueFull && <p role="alert" className="text-sm text-destructive">{t('browserUse.liveControlQueueFull')}</p>}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-950">
          {frame && (
            <img
              ref={image}
              src={frame}
              alt={t('browserUse.screenshotAlt')}
              className="block max-h-full max-w-full cursor-crosshair touch-none select-none"
              draggable={false}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => { gesture.current = null; }}
            />
          )}
          {!frame && <p role="status" className="text-sm text-white">{t('browserUse.waitingScreenshot')}</p>}
          <textarea
            ref={keyboard}
            tabIndex={-1}
            aria-label={t('browserUse.liveControlKeyboard')}
            className="absolute left-1/2 top-1/2 h-px w-px opacity-0"
            spellCheck={false}
            autoComplete="off"
            onKeyDown={keyDown}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => { composing.current = false; sendText(event.currentTarget); }}
            onChange={(event) => { if (!composing.current) sendText(event.currentTarget); }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
