// DarkModeToggle component tests
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DarkModeToggle from '../../../src/components/DarkModeToggle';

// Mock the ThemeContext
const mockThemeContext = {
  isDarkMode: false,
  toggleDarkMode: jest.fn()
};

jest.mock('../../../src/contexts/ThemeContext', () => ({
  useTheme: () => mockThemeContext
}));

describe('DarkModeToggle Component', () => {
  beforeEach(() => {
    mockThemeContext.toggleDarkMode.mockClear();
  });

  test('renders toggle button with correct accessibility attributes', () => {
    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch', { name: /toggle dark mode/i });

    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('aria-checked', 'false');
    expect(toggleButton).toHaveAttribute('aria-label', 'Toggle dark mode');
  });

  test('shows sun icon when dark mode is off', () => {
    mockThemeContext.isDarkMode = false;

    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');
    expect(toggleButton).toHaveAttribute('aria-checked', 'false');

    // Check for sun icon (should be present when dark mode is off)
    const sunIcon = toggleButton.querySelector('svg');
    expect(sunIcon).toBeInTheDocument();

    // The sun icon should have specific path for sun rays
    expect(sunIcon.innerHTML).toContain('M12 3v1m0 16v1m9-9h-1M4 12H3');
  });

  test('shows moon icon when dark mode is on', () => {
    mockThemeContext.isDarkMode = true;

    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');
    expect(toggleButton).toHaveAttribute('aria-checked', 'true');

    // Check for moon icon (should be present when dark mode is on)
    const moonIcon = toggleButton.querySelector('svg');
    expect(moonIcon).toBeInTheDocument();

    // The moon icon should have specific path for moon
    expect(moonIcon.innerHTML).toContain('M20.354 15.354A9 9 0 018.646 3.646');
  });

  test('calls toggleDarkMode when button is clicked', () => {
    mockThemeContext.isDarkMode = false;

    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');
    fireEvent.click(toggleButton);

    expect(mockThemeContext.toggleDarkMode).toHaveBeenCalledTimes(1);
  });

  test('calls toggleDarkMode when button is clicked with keyboard', () => {
    mockThemeContext.isDarkMode = false;

    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');
    fireEvent.keyPress(toggleButton, { key: 'Enter', charCode: 13 });

    expect(mockThemeContext.toggleDarkMode).toHaveBeenCalledTimes(1);
  });

  test('applies correct CSS classes for light mode', () => {
    mockThemeContext.isDarkMode = false;

    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');
    const toggleThumb = toggleButton.querySelector('span:not(.sr-only)');

    expect(toggleButton).toHaveClass(
      'relative',
      'inline-flex',
      'h-8',
      'w-14',
      'items-center',
      'rounded-full',
      'bg-gray-200',
      'dark:bg-gray-700',
      'transition-colors',
      'duration-200',
      'focus:outline-none',
      'focus:ring-2',
      'focus:ring-blue-500',
      'focus:ring-offset-2',
      'dark:focus:ring-offset-gray-900'
    );

    expect(toggleThumb).toHaveClass(
      'inline-block',
      'h-6',
      'w-6',
      'transform',
      'rounded-full',
      'bg-white',
      'shadow-lg',
      'transition-transform',
      'duration-200',
      'flex',
      'items-center',
      'justify-center',
      'translate-x-1' // Position when dark mode is off
    );
  });

  test('applies correct CSS classes for dark mode', () => {
    mockThemeContext.isDarkMode = true;

    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');
    const toggleThumb = toggleButton.querySelector('span:not(.sr-only)');

    expect(toggleThumb).toHaveClass('translate-x-7'); // Position when dark mode is on
  });

  test('includes screen reader only text', () => {
    render(<DarkModeToggle />);

    const srOnlyText = screen.getByText('Toggle dark mode');
    expect(srOnlyText).toBeInTheDocument();
    expect(srOnlyText).toHaveClass('sr-only');
  });

  test('sun icon has correct attributes when dark mode is off', () => {
    mockThemeContext.isDarkMode = false;

    render(<DarkModeToggle />);

    const sunIcon = screen.getByRole('switch').querySelector('svg');

    expect(sunIcon).toHaveAttribute('fill', 'none');
    expect(sunIcon).toHaveAttribute('viewBox', '0 0 24 24');
    expect(sunIcon).toHaveAttribute('stroke', 'currentColor');
    expect(sunIcon).toHaveAttribute('strokeWidth', '2');
    expect(sunIcon).toHaveClass('w-3.5', 'h-3.5', 'text-yellow-500');
  });

  test('moon icon has correct attributes when dark mode is on', () => {
    mockThemeContext.isDarkMode = true;

    render(<DarkModeToggle />);

    const moonIcon = screen.getByRole('switch').querySelector('svg');

    expect(moonIcon).toHaveAttribute('fill', 'none');
    expect(moonIcon).toHaveAttribute('viewBox', '0 0 24 24');
    expect(moonIcon).toHaveAttribute('stroke', 'currentColor');
    expect(moonIcon).toHaveAttribute('strokeWidth', '2');
    expect(moonIcon).toHaveClass('w-3.5', 'h-3.5', 'text-gray-700');
  });

  test('handles rapid toggle clicks correctly', () => {
    mockThemeContext.isDarkMode = false;

    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');

    // Click multiple times rapidly
    fireEvent.click(toggleButton);
    fireEvent.click(toggleButton);
    fireEvent.click(toggleButton);

    expect(mockThemeContext.toggleDarkMode).toHaveBeenCalledTimes(3);
  });

  test('maintains accessibility with keyboard navigation', () => {
    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');

    // Test space key
    fireEvent.keyDown(toggleButton, { key: ' ', charCode: 32 });
    expect(mockThemeContext.toggleDarkMode).toHaveBeenCalledTimes(1);

    // Test Enter key
    fireEvent.keyDown(toggleButton, { key: 'Enter', charCode: 13 });
    expect(mockThemeContext.toggleDarkMode).toHaveBeenCalledTimes(2);
  });

  test('button receives focus correctly', () => {
    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');

    toggleButton.focus();
    expect(toggleButton).toHaveFocus();
  });

  test('focus ring styles are applied correctly', () => {
    render(<DarkModeToggle />);

    const toggleButton = screen.getByRole('switch');

    expect(toggleButton).toHaveClass('focus:outline-none', 'focus:ring-2', 'focus:ring-blue-500');
  });
});