// ErrorBoundary component tests
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../../../src/components/ErrorBoundary';

// Component that throws an error for testing
const ThrowErrorComponent = ({ shouldThrow = false }) => {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div>No error</div>;
};

// Component that throws a different error
const ThrowDifferentErrorComponent = ({ shouldThrow = false }) => {
  if (shouldThrow) {
    throw new TypeError('Test type error');
  }
  return <div>No type error</div>;
};

describe('ErrorBoundary Component', () => {
  let consoleSpy;

  beforeEach(() => {
    // Mock console.error to avoid noise in test output
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowErrorComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('No error')).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  test('catches and displays error boundary UI when child throws error', () => {
    render(
      <ErrorBoundary>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.queryByText('No error')).not.toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/an error occurred while loading the chat interface/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  test('logs error to console when error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      'ErrorBoundary caught an error:',
      expect.any(Error),
      expect.objectContaining({
        componentStack: expect.any(String)
      })
    );
  });

  test('resets error state when try again button is clicked', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Initially shows error state
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    // Click try again button
    const tryAgainButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(tryAgainButton);

    // Rerender with non-throwing component
    rerender(
      <ErrorBoundary>
        <ThrowErrorComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    // Should show normal content now
    expect(screen.getByText('No error')).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  test('calls onRetry callback when try again button is clicked', () => {
    const mockOnRetry = jest.fn();

    render(
      <ErrorBoundary onRetry={mockOnRetry}>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    const tryAgainButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(tryAgainButton);

    expect(mockOnRetry).toHaveBeenCalledTimes(1);
  });

  test('shows error details when showDetails prop is true', () => {
    render(
      <ErrorBoundary showDetails={true}>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText(/error details/i)).toBeInTheDocument();

    // Expand details
    const detailsSummary = screen.getByText(/error details/i);
    fireEvent.click(detailsSummary);

    expect(screen.getByText(/test error message/i)).toBeInTheDocument();
  });

  test('hides error details when showDetails prop is false', () => {
    render(
      <ErrorBoundary showDetails={false}>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.queryByText(/error details/i)).not.toBeInTheDocument();
  });

  test('handles different types of errors', () => {
    render(
      <ErrorBoundary>
        <ThrowDifferentErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  test('clears previous error when new error occurs', () => {
    const { rerender } = render(
      <ErrorBoundary showDetails={true}>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Initial error
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    // Expand details to see first error
    const detailsSummary = screen.getByText(/error details/i);
    fireEvent.click(detailsSummary);
    expect(screen.getByText(/test error message/i)).toBeInTheDocument();

    // Click try again to reset
    const tryAgainButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(tryAgainButton);

    // Rerender with different error
    rerender(
      <ErrorBoundary showDetails={true}>
        <ThrowDifferentErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Should show new error state
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    // Details should show new error
    fireEvent.click(detailsSummary);
    expect(screen.getByText(/test type error/i)).toBeInTheDocument();
  });

  test('error boundary has proper accessibility attributes', () => {
    render(
      <ErrorBoundary>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Check that button is focusable
    const tryAgainButton = screen.getByRole('button', { name: /try again/i });
    expect(tryAgainButton).toHaveAttribute('type', 'button');

    // Check that details summary is keyboard accessible when present
    // (This test assumes showDetails={true})
    render(
      <ErrorBoundary showDetails={true}>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    const detailsSummary = screen.getByText(/error details/i);
    expect(detailsSummary.tagName).toBe('SUMMARY');
  });

  test('error boundary maintains correct CSS classes', () => {
    render(
      <ErrorBoundary>
        <ThrowErrorComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    const errorContainer = screen.getByText(/something went wrong/i).closest('div').parentElement.parentElement;
    expect(errorContainer).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center', 'p-8', 'text-center');

    const errorBox = screen.getByText(/something went wrong/i).closest('div');
    expect(errorBox).toHaveClass('bg-red-50', 'border', 'border-red-200', 'rounded-lg', 'p-6', 'max-w-md');
  });
});