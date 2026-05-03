import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import EmptyState from './EmptyState';

describe('EmptyState', () => {
  it('renders the heading', () => {
    render(<EmptyState onSuggestionClick={vi.fn()} />);
    expect(screen.getByText('How can I help you today?')).toBeDefined();
  });

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
});
