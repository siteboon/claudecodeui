// ThemeContext tests
import React from 'react';
import { render, screen, fireEvent } from '../utils/test-utils';
import { jest } from '@jest/globals';
import { ThemeProvider, useTheme } from '../../../src/contexts/ThemeContext';

// Test component to consume the context
const TestComponent = () => {
  const { isDarkMode, toggleDarkMode } = useTheme();

  return (
    <div>
      <div data-testid="theme-status">{isDarkMode ? 'dark' : 'light'}</div>
      <button data-testid="toggle-button" onClick={toggleDarkMode}>
        Toggle Theme
      </button>
    </div>
  );
};

// Test component that should throw error when used without provider
const TestComponentWithoutProvider = () => {
  try {
    const { isDarkMode } = useTheme();
    return <div data-testid="theme-value">{isDarkMode ? 'dark' : 'light'}</div>;
  } catch (error) {
    return <div data-testid="error-message">{error.message}</div>;
  }
};

describe('ThemeContext', () => {
  let localStorageMock;
  let matchMediaMock;

  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();
    localStorageMock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true
    });

    // Mock matchMedia
    matchMediaMock = jest.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
    Object.defineProperty(window, 'matchMedia', {
      value: matchMediaMock,
      writable: true
    });

    // Mock document.documentElement
    Object.defineProperty(document, 'documentElement', {
      value: {
        classList: {
          add: jest.fn(),
          remove: jest.fn(),
          contains: jest.fn()
        }
      },
      writable: true
    });

    // Mock document.querySelector
    Object.defineProperty(document, 'querySelector', {
      value: jest.fn(() => ({
        setAttribute: jest.fn()
      })),
      writable: true
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('provides default theme context values', () => {
    localStorageMock.getItem.mockReturnValue(null);
    matchMediaMock.mockReturnValue({ matches: false }); // Light mode preference

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme-status')).toHaveTextContent('light');
    expect(screen.getByTestId('toggle-button')).toBeInTheDocument();
  });

  test('provides dark theme when system preference is dark', () => {
    localStorageMock.getItem.mockReturnValue(null);
    matchMediaMock.mockReturnValue({ matches: true }); // Dark mode preference

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme-status')).toHaveTextContent('dark');
  });

  test('loads saved theme from localStorage', () => {
    localStorageMock.getItem.mockReturnValue('dark');

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme-status')).toHaveTextContent('dark');
  });

  test('loads light theme from localStorage', () => {
    localStorageMock.getItem.mockReturnValue('light');

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme-status')).toHaveTextContent('light');
  });

  test('toggles theme when toggleDarkMode is called', () => {
    localStorageMock.getItem.mockReturnValue(null);
    matchMediaMock.mockReturnValue({ matches: false });

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    // Initially light
    expect(screen.getByTestId('theme-status')).toHaveTextContent('light');

    // Toggle to dark
    const toggleButton = screen.getByTestId('toggle-button');
    fireEvent.click(toggleButton);
    expect(screen.getByTestId('theme-status')).toHaveTextContent('dark');

    // Toggle back to light
    fireEvent.click(toggleButton);
    expect(screen.getByTestId('theme-status')).toHaveTextContent('light');
  });

  test('updates localStorage when theme changes', () => {
    localStorageMock.getItem.mockReturnValue(null);
    matchMediaMock.mockReturnValue({ matches: false });

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    const toggleButton = screen.getByTestId('toggle-button');

    // Toggle to dark mode
    fireEvent.click(toggleButton);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');

    // Toggle back to light mode
    fireEvent.click(toggleButton);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light');
  });

  test('updates document class when theme changes', () => {
    localStorageMock.getItem.mockReturnValue(null);
    matchMediaMock.mockReturnValue({ matches: false });

    const { classList } = document.documentElement;

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    const toggleButton = screen.getByTestId('toggle-button');

    // Toggle to dark mode
    fireEvent.click(toggleButton);
    expect(classList.add).toHaveBeenCalledWith('dark');

    // Toggle back to light mode
    fireEvent.click(toggleButton);
    expect(classList.remove).toHaveBeenCalledWith('dark');
  });

  test('throws error when useTheme is used without ThemeProvider', () => {
    render(<TestComponentWithoutProvider />);

    expect(screen.getByTestId('error-message')).toHaveTextContent(
      'useTheme must be used within a ThemeProvider'
    );
  });

  test('listens to system theme changes when no saved preference', () => {
    localStorageMock.getItem.mockReturnValue(null);

    let mediaQueryCallback;
    const mockMediaQuery = {
      matches: false,
      addEventListener: jest.fn((event, callback) => {
        if (event === 'change') {
          mediaQueryCallback = callback;
        }
      }),
      removeEventListener: jest.fn()
    };
    matchMediaMock.mockReturnValue(mockMediaQuery);

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme-status')).toHaveTextContent('light');
    expect(mockMediaQuery.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    // Simulate system theme change to dark
    mediaQueryCallback({ matches: true });
    expect(screen.getByTestId('theme-status')).toHaveTextContent('dark');
  });

  test('does not update theme when system changes but user has saved preference', () => {
    localStorageMock.getItem.mockReturnValue('light');

    let mediaQueryCallback;
    const mockMediaQuery = {
      matches: false,
      addEventListener: jest.fn((event, callback) => {
        if (event === 'change') {
          mediaQueryCallback = callback;
        }
      }),
      removeEventListener: jest.fn()
    };
    matchMediaMock.mockReturnValue(mockMediaQuery);

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme-status')).toHaveTextContent('light');

    // Simulate system theme change to dark (should not affect since user has saved preference)
    mediaQueryCallback({ matches: true });
    expect(screen.getByTestId('theme-status')).toHaveTextContent('light');
  });

  test('removes event listener on unmount', () => {
    localStorageMock.getItem.mockReturnValue(null);

    const mockMediaQuery = {
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };
    matchMediaMock.mockReturnValue(mockMediaQuery);

    const { unmount } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    unmount();

    expect(mockMediaQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  test('handles missing localStorage gracefully', () => {
    delete window.localStorage;

    matchMediaMock.mockReturnValue({ matches: false });

    expect(() => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );
    }).not.toThrow();
  });

  test('handles missing matchMedia gracefully', () => {
    localStorageMock.getItem.mockReturnValue(null);
    delete window.matchMedia;

    expect(() => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );
    }).not.toThrow();

    // Should default to light mode
    expect(screen.getByTestId('theme-status')).toHaveTextContent('light');
  });
});