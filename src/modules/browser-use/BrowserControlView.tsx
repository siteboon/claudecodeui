import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson, ApiRequestError } from '@/shared/api';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';

type Point = { x: number; y: number };
type LiveInput =
  | ({ type: 'pointer'; to?: Point } & Point)
  | ({ type: 'wheel'; dx: number; dy: number } & Point)
  | { type: 'text'; text: string }
  | { type: 'key'; key: string };

type BrowserControlViewProps = {
  sessionId: string;
  controlId: string;
  onClose: () => void;
  onLost: () => void;
  onReturned: () => void;
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

/** Used by BrowserUsePanel to control an existing Chromium page inside the workspace. */
export default function BrowserControlView({ sessionId, controlId, onClose, onLost, onReturned }: BrowserControlViewProps) {
  const { t } = useTranslation('settings');
  // The private frame is kept only inside the live viewer.
  const [frame, setFrame] = useState<string | null>(null);
  // Keep transient input or preview errors visible while the viewer remains open.
  const [failed, setFailed] = useState(false);
  // Prevent duplicate hand-back requests while the server drains pending input.
  const [returning, setReturning] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const gesture = useRef<Point | null>(null);
  const composing = useRef(false);
  const inputTail = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);
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
          onLost();
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

  const send = useCallback((input: LiveInput) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || queued.current >= 32) return;
    queued.current++;
    inputTail.current = inputTail.current.then(async () => {
      if (signal.aborted) return;
      await readApiJson(await api.browserUse.control(sessionId, 'input', { controlId, ...input }, { signal }));
      if (!signal.aborted) setFailed(false);
    }).catch(() => {
      if (!signal.aborted) setFailed(true);
    }).finally(() => {
      queued.current--;
    });
  }, [sessionId, controlId]);

  useEffect(() => {
    const element = image.current;
    if (!element || !hasFrame) return;
    let pending: (Point & { dx: number; dy: number }) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1;
      pending = {
        ...pointAt(element, event.clientX, event.clientY),
        dx: (pending?.dx ?? 0) + event.deltaX * scale,
        dy: (pending?.dy ?? 0) + event.deltaY * scale,
      };
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        const clamp = (delta: number) => Math.max(-2_000, Math.min(2_000, delta));
        if (pending) send({ ...pending, type: 'wheel', dx: clamp(pending.dx), dy: clamp(pending.dy) });
        pending = undefined;
        timer = undefined;
      }, 40);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      clearTimeout(timer);
    };
  }, [hasFrame, send]);

  const pointerDown = (event: PointerEvent<HTMLImageElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    gesture.current = pointAt(event.currentTarget, event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    keyboard.current?.focus({ preventScroll: true });
  };

  const pointerUp = (event: PointerEvent<HTMLImageElement>) => {
    if (!event.isPrimary || !gesture.current) return;
    const start = gesture.current;
    gesture.current = null;
    const end = pointAt(event.currentTarget, event.clientX, event.clientY);
    const isDrag = Math.hypot(start.x - end.x, start.y - end.y) > 0.005;
    send({ type: 'pointer', ...start, ...(isDrag ? { to: end } : {}) });
  };

  const sendText = (element: HTMLTextAreaElement) => {
    if (!element.value) return;
    const characters = Array.from(element.value);
    for (let i = 0; i < characters.length; i += 1000) {
      send({ type: 'text', text: characters.slice(i, i + 1000).join('') });
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
    setReturning(true);
    try {
      await inputTail.current;
      await readApiJson(await api.browserUse.control(sessionId, 'release', { controlId }));
      onReturned();
    } catch {
      setFailed(true);
    } finally {
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
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-950">
          {frame && (
            <img
              ref={image}
              src={frame}
              alt={t('browserUse.screenshotAlt')}
              className="block max-h-full max-w-full cursor-crosshair touch-none select-none"
              draggable={false}
              onPointerDown={pointerDown}
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
