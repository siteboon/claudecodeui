import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastVariant = 'default' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number; // ms, default 3000
}

interface ToastEntry extends ToastOptions {
  id: number;
  exiting: boolean;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Variant styles
// ---------------------------------------------------------------------------

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default:
    'border-border bg-popover text-popover-foreground',
  success:
    'border-green-300 bg-green-50 text-green-900 dark:border-green-700 dark:bg-green-900/30 dark:text-green-100',
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100',
  error:
    'border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100',
};

// ---------------------------------------------------------------------------
// Provider + renderer
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((opts: ToastOptions) => {
    const id = ++idRef.current;
    const duration = opts.duration ?? 3000;

    setToasts((prev) => [...prev, { ...opts, id, exiting: false }]);

    // Start exit animation before removing
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
      );
    }, duration - 300);

    // Remove from DOM
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none fixed bottom-4 right-4 z-[10010] flex flex-col-reverse gap-2"
            aria-live="polite"
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                className={cn(
                  'pointer-events-auto min-w-[220px] max-w-sm rounded-lg border px-4 py-3 shadow-lg transition-all duration-300',
                  t.exiting
                    ? 'translate-x-full opacity-0'
                    : 'translate-x-0 opacity-100 animate-in slide-in-from-right-full',
                  VARIANT_CLASSES[t.variant ?? 'default'],
                )}
              >
                <p className="text-sm font-semibold">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs opacity-80">{t.description}</p>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
