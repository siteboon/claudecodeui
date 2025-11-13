// Simple component test to verify React Testing Library setup
import React from 'react';
import { render, screen } from '@testing-library/react';

// Simple test component
const TestComponent = ({ message = 'Hello World' }) => {
  return <div data-testid="test-component">{message}</div>;
};

describe('Simple Component Tests', () => {
  test('renders component with default message', () => {
    render(<TestComponent />);

    expect(screen.getByTestId('test-component')).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  test('renders component with custom message', () => {
    render(<TestComponent message="Custom Message" />);

    expect(screen.getByTestId('test-component')).toBeInTheDocument();
    expect(screen.getByText('Custom Message')).toBeInTheDocument();
  });

  test('component has correct structure', () => {
    render(<TestComponent />);

    const element = screen.getByTestId('test-component');
    expect(element.tagName).toBe('DIV');
  });
});