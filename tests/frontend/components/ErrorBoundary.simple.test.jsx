// ErrorBoundary component tests (simplified version)
import React from 'react';
import { jest } from '@jest/globals';
import { render, screen, fireEvent } from '../utils/test-utils';

// Simple ErrorBoundary implementation for testing
class SimpleErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ error });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div data-testid="error-boundary-fallback">
          <h1>Something went wrong</h1>
          <p>An error occurred while loading the component.</p>
          {this.props.showDetails && this.state.error && (
            <details data-testid="error-details">
              <summary>Error Details</summary>
              <pre data-testid="error-message">
                {this.state.error.toString()}
              </pre>
            </details>
          )}
          <button
            data-testid="retry-button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onRetry) this.props.onRetry();
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Component that throws an error for testing
const ThrowErrorComponent = ({ shouldThrow = false }) => {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div data-testid="normal-content">No error</div>;
};

describe('SimpleErrorBoundary Component', () => {
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
      <SimpleErrorBoundary>
        <ThrowErrorComponent shouldThrow={false} />
      </SimpleErrorBoundary>
    );

    expect(screen.getByTestId('normal-content')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument();
  });

  test('catches and displays error boundary UI when child throws error', () => {
    render(
      <SimpleErrorBoundary>
        <ThrowErrorComponent shouldThrow={true} />
      </SimpleErrorBoundary>
    );

    expect(screen.queryByTestId('normal-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/an error occurred while loading the component/i)).toBeInTheDocument();
    expect(screen.getByTestId('retry-button')).toBeInTheDocument();
  });

  test('logs error to console when error occurs', () => {
    render(
      <SimpleErrorBoundary>
        <ThrowErrorComponent shouldThrow={true} />
      </SimpleErrorBoundary>
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      'ErrorBoundary caught an error:',
      expect.any(Error),
      expect.any(Object)
    );
  });

  test('resets error state when try again button is clicked', () => {
    const { rerender } = render(
      <SimpleErrorBoundary>
        <ThrowErrorComponent shouldThrow={true} />
      </SimpleErrorBoundary>
    );

    // Initially shows error state
    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();

    // Click try again button
    const retryButton = screen.getByTestId('retry-button');
    fireEvent.click(retryButton);

    // Rerender with non-throwing component
    rerender(
      <SimpleErrorBoundary>
        <ThrowErrorComponent shouldThrow={false} />
      </SimpleErrorBoundary>
    );

    // Should show normal content now
    expect(screen.getByTestId('normal-content')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument();
  });

  test('calls onRetry callback when try again button is clicked', () => {
    const mockOnRetry = jest.fn();

    render(
      <SimpleErrorBoundary onRetry={mockOnRetry}>
        <ThrowErrorComponent shouldThrow={true} />
      </SimpleErrorBoundary>
    );

    const retryButton = screen.getByTestId('retry-button');
    fireEvent.click(retryButton);

    expect(mockOnRetry).toHaveBeenCalledTimes(1);
  });

  test('shows error details when showDetails prop is true', () => {
    render(
      <SimpleErrorBoundary showDetails={true}>
        <ThrowErrorComponent shouldThrow={true} />
      </SimpleErrorBoundary>
    );

    expect(screen.getByTestId('error-details')).toBeInTheDocument();

    // Expand details
    const detailsSummary = screen.getByText('Error Details');
    fireEvent.click(detailsSummary);

    expect(screen.getByTestId('error-message')).toBeInTheDocument();
    expect(screen.getByTestId('error-message')).toHaveTextContent('Test error message');
  });

  test('hides error details when showDetails prop is false', () => {
    render(
      <SimpleErrorBoundary showDetails={false}>
        <ThrowErrorComponent shouldThrow={true} />
      </SimpleErrorBoundary>
    );

    expect(screen.queryByTestId('error-details')).not.toBeInTheDocument();
  });

  test('handles multiple clicks on retry button', () => {
    const mockOnRetry = jest.fn();

    render(
      <SimpleErrorBoundary onRetry={mockOnRetry}>
        <ThrowErrorComponent shouldThrow={true} />
      </SimpleErrorBoundary>
    );

    const retryButton = screen.getByTestId('retry-button');

    // Click multiple times
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    expect(mockOnRetry).toHaveBeenCalledTimes(3);
  });

  test('error boundary catches different types of errors', () => {
    const ThrowTypeErrorComponent = () => {
      throw new TypeError('Test type error');
    };

    render(
      <SimpleErrorBoundary>
        <ThrowTypeErrorComponent />
      </SimpleErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('retry-button')).toBeInTheDocument();
  });
});