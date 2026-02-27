import React, { useCallback, useState } from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary, showDetails, componentStack }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
        <div className="flex items-center mb-4">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="ml-3 text-sm font-medium text-red-800">
            Something went wrong
          </h3>
        </div>
        <div className="text-sm text-red-700">
          <p className="mb-2">An error occurred while loading the chat interface.</p>
          {showDetails && error && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-mono">Error Details</summary>
              <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-auto max-h-40">
                {error.toString()}
                {componentStack}
              </pre>
            </details>
          )}
        </div>
        <div className="mt-4">
          <button
            onClick={resetErrorBoundary}
            className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorBoundary({ children, showDetails = false, onRetry = undefined, resetKeys = undefined }) {
  const [componentStack, setComponentStack] = useState(null);

  const handleError = useCallback((error, errorInfo) => {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    setComponentStack(errorInfo?.componentStack || null);
  }, []);

  const handleReset = useCallback(() => {
    setComponentStack(null);
    onRetry?.();
  }, [onRetry]);

  const renderFallback = useCallback(({ error, resetErrorBoundary }) => (
    <ErrorFallback
      error={error}
      resetErrorBoundary={resetErrorBoundary}
      showDetails={showDetails}
      componentStack={componentStack}
    />
  ), [showDetails, componentStack]);

  return (
    <ReactErrorBoundary
      fallbackRender={renderFallback}
      onError={handleError}
      onReset={handleReset}
      resetKeys={resetKeys}
    >
      {children}
    </ReactErrorBoundary>
  );
}

export default ErrorBoundary;
