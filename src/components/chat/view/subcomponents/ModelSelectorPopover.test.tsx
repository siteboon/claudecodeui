import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ModelSelectorPopover from './ModelSelectorPopover';

const providers = [
  { id: 'claude', label: 'Claude', models: ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku'] },
  { id: 'gemini', label: 'Gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
];

describe('ModelSelectorPopover', () => {
  it('renders provider tabs', () => {
    render(
      <ModelSelectorPopover
        isOpen={true}
        onClose={vi.fn()}
        providers={providers}
        selectedProvider="claude"
        selectedModel="claude-sonnet-4"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Claude')).toBeDefined();
    expect(screen.getByText('Gemini')).toBeDefined();
  });

  it('renders model list for selected provider', () => {
    render(
      <ModelSelectorPopover
        isOpen={true}
        onClose={vi.fn()}
        providers={providers}
        selectedProvider="claude"
        selectedModel="claude-sonnet-4"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('claude-opus-4')).toBeDefined();
    expect(screen.getByText('claude-sonnet-4')).toBeDefined();
    expect(screen.getByText('claude-haiku')).toBeDefined();
  });

  it('marks the selected model with a checkmark', () => {
    const { container } = render(
      <ModelSelectorPopover
        isOpen={true}
        onClose={vi.fn()}
        providers={providers}
        selectedProvider="claude"
        selectedModel="claude-sonnet-4"
        onSelect={vi.fn()}
      />,
    );
    const selected = container.querySelector('[data-testid="model-item-claude-sonnet-4"]');
    expect(selected).toBeDefined();
    expect(selected!.querySelector('[data-testid="model-check"]')).toBeDefined();
  });

  it('calls onSelect with provider and model when a model is clicked', () => {
    const onSelect = vi.fn();
    render(
      <ModelSelectorPopover
        isOpen={true}
        onClose={vi.fn()}
        providers={providers}
        selectedProvider="claude"
        selectedModel="claude-sonnet-4"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('claude-opus-4'));
    expect(onSelect).toHaveBeenCalledWith('claude', 'claude-opus-4');
  });

  it('switches model list when clicking a different provider tab', () => {
    render(
      <ModelSelectorPopover
        isOpen={true}
        onClose={vi.fn()}
        providers={providers}
        selectedProvider="claude"
        selectedModel="claude-sonnet-4"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Gemini'));
    expect(screen.getByText('gemini-2.5-pro')).toBeDefined();
    expect(screen.getByText('gemini-2.5-flash')).toBeDefined();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ModelSelectorPopover
        isOpen={false}
        onClose={vi.fn()}
        providers={providers}
        selectedProvider="claude"
        selectedModel="claude-sonnet-4"
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="model-selector-popover"]')).toBeNull();
  });
});
