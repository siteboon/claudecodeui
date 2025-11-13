// Testing utilities for React components
import React from 'react';
import { render } from '@testing-library/react';

// Mock contexts providers
const MockThemeContext = ({ children }) => {
  return (
    <div data-testid="mock-theme-provider">
      {children}
    </div>
  );
};

const MockAuthContext = ({ children }) => {
  return (
    <div data-testid="mock-auth-provider">
      {children}
    </div>
  );
};

// Custom render function with optional providers
const customRender = (ui, options = {}) => {
  const {
    withTheme = false,
    withAuth = false,
    ...renderOptions
  } = options;

  let Wrapper = ({ children }) => children;

  if (withTheme && withAuth) {
    Wrapper = ({ children }) => (
      <MockAuthContext>
        <MockThemeContext>
          {children}
        </MockThemeContext>
      </MockAuthContext>
    );
  } else if (withTheme) {
    Wrapper = MockThemeContext;
  } else if (withAuth) {
    Wrapper = MockAuthContext;
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

// Re-export everything from testing-library
export * from '@testing-library/react';
export { customRender as render };

// Mock component that throws error
export const ThrowErrorComponent = ({ shouldThrow = false, children }) => {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return children || <div>No error</div>;
};

// Mock component for testing different error types
export const ThrowTypeErrorComponent = ({ shouldThrow = false }) => {
  if (shouldThrow) {
    throw new TypeError('Test type error');
  }
  return <div>No type error</div>;
};

// Helper to create mock props
export const createMockProps = (overrides = {}) => ({
  ...overrides,
});

// Helper to test async operations
export const waitForAsync = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));