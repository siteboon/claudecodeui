import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { api } from '@/shared/api';
import type { ChatImage } from '@/shared/types';

type ChatMessageImagesProps = {
  images: ChatImage[];
  projectId?: string | null;
};

/**
 * Resolves one chat image to a displayable src. Inline data URLs are used
 * directly; path-based attachments are fetched as blobs (a bare <img src>
 * cannot carry the auth header) — first from the global assets route
 * (`~/.cloudcli/assets`), then from the project files route as a fallback for
 * sessions recorded before attachments moved to the global store.
 */
function useChatImageSrc(image: ChatImage, projectId?: string | null): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(image.data || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image.data) {
      setSrc(image.data);
      setFailed(false);
      return;
    }

    const imagePath = image.path;
    if (!imagePath) {
      setSrc(null);
      setFailed(true);
      return;
    }

    const filename = imagePath.split(/[\\/]/).pop() || '';
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const candidateRequests: Array<() => Promise<Response>> = [
      () => api.assets.image(filename, { signal: controller.signal }),
      ...(projectId
        ? [() => api.readFileBlob(projectId, imagePath, { signal: controller.signal })]
        : []),
    ];

    const load = async () => {
      setFailed(false);
      for (const requestCandidate of candidateRequests) {
        try {
          const response = await requestCandidate();
          if (!response.ok) {
            continue;
          }
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
        }
      }
      setSrc(null);
      setFailed(true);
    };

    void load();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image.data, image.path, projectId]);

  return { src, failed };
}

/**
 * Fullscreen image overlay in the claude.ai style: dark backdrop, centered
 * image, closes on backdrop click, close button, or Escape. The image itself
 * zooms with the mouse wheel, a trackpad pinch (which arrives as ctrl+wheel),
 * or a two-finger touch pinch, and pans by dragging (one finger when zoomed,
 * two fingers anytime).
 *
 * Used by chat's ChatMessageImages and ComposerAttachment to expand a
 * thumbnail to full size, and by chat's ToolResultImages for images carried
 * inside a tool result.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ startDist: number; startMid: { x: number; y: number }; startScale: number; startOffset: { x: number; y: number } } | null>(null);
  const scaleRef = useRef(1);
  scaleRef.current = scale;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // Wheel zoom has to preventDefault (the backdrop would otherwise scroll /
  // the browser would page-zoom on ctrl+wheel), and React's synthetic onWheel
  // is passive — register natively with the flag instead.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setScale((current) => {
        const factor = Math.exp(-event.deltaY * 0.0015);
        return Math.min(10, Math.max(1, current * factor));
      });
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, []);

  // Zooming back out to 1 re-centers; a stale offset would park the image
  // off-screen until the next zoom.
  useEffect(() => {
    if (scale === 1) {
      setOffset({ x: 0, y: 0 });
    }
  }, [scale]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // Capture can throw for a pointer that ended between dispatch and here;
    // the gesture must survive that (a lifted finger mid-pinch is routine).
    try {
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // fall through
    }

    if (pointers.size === 2) {
      // A second finger starts a pinch; the single-finger drag ends.
      dragRef.current = null;
      setDragging(false);
      const [a, b] = [...pointers.values()];
      pinchRef.current = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        startScale: scaleRef.current,
        startOffset: { ...offsetRef.current },
      };
      return;
    }

    if (pointers.size === 1 && scaleRef.current > 1) {
      event.stopPropagation();
      dragRef.current = {
        startX: event.clientX, startY: event.clientY,
        originX: offsetRef.current.x, originY: offsetRef.current.y,
      };
      setDragging(true);
    }
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) {
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const pinch = pinchRef.current;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const next = Math.min(10, Math.max(1, pinch.startScale * (dist / pinch.startDist)));
      setScale(next);
      // Pan follows the pinch midpoint so two fingers also slide the image
      // around, anchored to where the gesture started.
      setOffset(next === 1
        ? { x: 0, y: 0 }
        : {
          x: pinch.startOffset.x + (mid.x - pinch.startMid.x),
          y: pinch.startOffset.y + (mid.y - pinch.startMid.y),
        });
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      setOffset({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      });
    }
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
      setDragging(false);
    }
  }, []);

  const handleImageClick = useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
    // A finished pinch or drag must not read as a tap-to-close.
    if (scaleRef.current <= 1 && pointersRef.current.size === 0) {
      onClose();
    }
  }, [onClose]);

  return createPortal(
    <div
      ref={viewportRef}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('chat:misc.closeImagePreview')}
        className="absolute right-4 top-4 z-[101] rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt}
        onClick={handleImageClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
          touchAction: 'none',
        }}
        className="max-h-[90vh] max-w-[92vw] select-none rounded-lg object-contain shadow-2xl will-change-transform"
        draggable={false}
      />
    </div>,
    document.body,
  );
}

function ChatMessageImage({ image, projectId }: { image: ChatImage; projectId?: string | null }) {
  const { t } = useTranslation();
  const { src, failed } = useChatImageSrc(image, projectId);
  const [expanded, setExpanded] = useState(false);
  const alt = image.name || 'Attached image';

  if (failed) {
    return (
      <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-border/50 bg-muted px-2 text-center text-[10px] text-muted-foreground">
        {alt}
      </div>
    );
  }

  if (!src) {
    return <div className="h-28 w-28 animate-pulse rounded-xl border border-border/50 bg-muted" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={t('chat:misc.expandImage', { name: alt })}
        className="block overflow-hidden rounded-xl border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
      >
        <img
          src={src}
          alt={alt}
          className="h-28 w-28 cursor-zoom-in object-cover transition-transform duration-200 hover:scale-105"
        />
      </button>
      {expanded && <ImageLightbox src={src} alt={alt} onClose={() => setExpanded(false)} />}
    </>
  );
}

/**
 * Image attachments for a user turn, rendered claude.ai-style: standalone
 * rounded square cards shown above the message bubble. Each thumbnail
 * expands to a fullscreen lightbox on click.
 *
 * Rendered by chat's MessageComponent for the images attached to a user turn.
 */
export default function ChatMessageImages({ images, projectId }: ChatMessageImagesProps) {
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {images.map((image, index) => (
        <ChatMessageImage key={image.path || image.name || index} image={image} projectId={projectId} />
      ))}
    </div>
  );
}
