import { type ErrorInfo, type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary as ReactErrorBoundary, type FallbackProps } from 'react-error-boundary';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function AppErrorFallback({ error, componentStack }: FallbackProps & { componentStack: string | null }) {
  const { t } = useTranslation();

  // A render error this high up the tree means provider/router state may be
  // inconsistent (see the investigation on #1128), so recovery reloads the
  // page instead of just unmounting/remounting the same broken subtree the
  // way resetErrorBoundary would.
  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
        <div className="mb-4 flex items-center">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h3 className="ml-3 text-sm font-medium text-red-800 dark:text-red-200">{t('misc.appErrorTitle')}</h3>
        </div>
        <div className="text-sm text-red-700 dark:text-red-300">
          <p className="mb-2">{t('misc.appErrorDescription')}</p>
          <details className="mt-4">
            <summary className="cursor-pointer font-mono text-xs">{t('misc.errorDetails')}</summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-red-100 p-2 text-xs dark:bg-red-900">
              {formatError(error)}
              {componentStack}
            </pre>
          </details>
        </div>
        <div className="mt-4">
          <button
            onClick={handleReload}
            className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {t('misc.reloadApp')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Root-level error boundary. Without this, an uncaught render error anywhere
 * in the auth/router/workspace tree unmounts the whole React root: the page
 * goes fully blank with only the host chrome (browser tab, PWA title bar,
 * Electron window frame) left on screen, no visible error, and no recovery
 * short of the user knowing to reload — see
 * https://github.com/siteboon/claudecodeui/issues/1128.
 */
function AppErrorBoundary({ children }: AppErrorBoundaryProps) {
  const [componentStack, setComponentStack] = useState<string | null>(null);

  const handleError = useCallback((error: Error, errorInfo: ErrorInfo) => {
    console.error('AppErrorBoundary caught an error:', error, errorInfo);
    setComponentStack(errorInfo?.componentStack ?? null);
  }, []);

  const renderFallback = useCallback(
    ({ error, resetErrorBoundary }: FallbackProps) => (
      <AppErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} componentStack={componentStack} />
    ),
    [componentStack]
  );

  return (
    <ReactErrorBoundary fallbackRender={renderFallback} onError={handleError}>
      {children}
    </ReactErrorBoundary>
  );
}

export default AppErrorBoundary;
