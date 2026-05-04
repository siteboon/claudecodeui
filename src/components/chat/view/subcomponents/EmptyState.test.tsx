import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import EmptyState, { getTimeOfDayGreeting } from './EmptyState';

describe('EmptyState', () => {
  it('renders suggestion chips', () => {
    render(<EmptyState onSuggestionClick={vi.fn()} />);
    expect(screen.getByText('Write code')).toBeDefined();
    expect(screen.getByText('Debug an issue')).toBeDefined();
    expect(screen.getByText('Explain a concept')).toBeDefined();
    expect(screen.getByText('Help me plan')).toBeDefined();
  });

  it('calls onSuggestionClick with prompt text when a chip is clicked', () => {
    const onSuggestionClick = vi.fn();
    render(<EmptyState onSuggestionClick={onSuggestionClick} />);
    fireEvent.click(screen.getByText('Write code'));
    expect(onSuggestionClick).toHaveBeenCalledWith('Write code for a REST API endpoint');
  });

  it('renders the sparkle icon', () => {
    const { container } = render(<EmptyState onSuggestionClick={vi.fn()} />);
    const sparkle = container.querySelector('[data-testid="claude-sparkle"]');
    expect(sparkle).toBeDefined();
  });

  it('renders suggestion descriptions', () => {
    render(<EmptyState onSuggestionClick={vi.fn()} />);
    expect(screen.getByText('for a REST API endpoint')).toBeDefined();
    expect(screen.getByText('in my application')).toBeDefined();
  });

  // E3: gradient background
  it('renders a gradient background container', () => {
    const { container } = render(<EmptyState onSuggestionClick={vi.fn()} />);
    const gradientEl = container.querySelector('[data-testid="empty-state-gradient"]');
    expect(gradientEl).not.toBeNull();
  });

  // E4: time-of-day greeting
  describe('getTimeOfDayGreeting', () => {
    it('returns Good morning for morning hours (5-11)', () => {
      expect(getTimeOfDayGreeting(8)).toBe('Good morning');
    });

    it('returns Good afternoon for afternoon hours (12-17)', () => {
      expect(getTimeOfDayGreeting(14)).toBe('Good afternoon');
    });

    it('returns Good evening for evening hours (18-4)', () => {
      expect(getTimeOfDayGreeting(20)).toBe('Good evening');
      expect(getTimeOfDayGreeting(2)).toBe('Good evening');
    });
  });

  it('displays a time-of-day greeting in the heading', () => {
    render(<EmptyState onSuggestionClick={vi.fn()} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(
      heading.textContent!.match(/Good (morning|afternoon|evening)/)
    ).not.toBeNull();
  });
});
