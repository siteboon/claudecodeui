import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ModelSelectorButton from './ModelSelectorPopover';

describe('ModelSelectorButton', () => {
  const defaultProps = {
    currentProvider: 'claude' as const,
    currentModel: 'opus',
    currentModelLabel: 'Opus',
    onSelect: vi.fn(),
  };

  it('renders the trigger button with model label', () => {
    render(<ModelSelectorButton {...defaultProps} />);
    expect(screen.getByText('Opus')).toBeDefined();
  });

  it('opens popover on click and shows provider tabs', () => {
    render(<ModelSelectorButton {...defaultProps} />);
    fireEvent.click(screen.getByText('Opus'));
    expect(screen.getByTestId('model-selector-popover')).toBeDefined();
    expect(screen.getByText('Anthropic')).toBeDefined();
    expect(screen.getByText('Google')).toBeDefined();
  });

  it('marks the selected model with a checkmark', () => {
    const { container } = render(<ModelSelectorButton {...defaultProps} />);
    fireEvent.click(screen.getByText('Opus'));
    const selected = container.querySelector('[data-testid="model-item-opus"]');
    expect(selected).toBeDefined();
    expect(selected!.querySelector('[data-testid="model-check"]')).toBeDefined();
  });

  it('calls onSelect with provider and model when a model is clicked', () => {
    const onSelect = vi.fn();
    render(<ModelSelectorButton {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Opus'));
    fireEvent.click(screen.getByText('Sonnet'));
    expect(onSelect).toHaveBeenCalledWith('claude', 'sonnet');
  });

  it('switches model list when clicking a different provider tab', () => {
    render(<ModelSelectorButton {...defaultProps} />);
    fireEvent.click(screen.getByText('Opus'));
    fireEvent.click(screen.getByText('Google'));
    expect(screen.getByText('Gemini 2.5 Pro')).toBeDefined();
  });

  it('does not show popover initially', () => {
    const { container } = render(<ModelSelectorButton {...defaultProps} />);
    expect(container.querySelector('[data-testid="model-selector-popover"]')).toBeNull();
  });
});
