import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import AssistantMessage from './AssistantMessage';

describe('AssistantMessage', () => {
  it('renders message content', () => {
    render(
      <AssistantMessage
        content="Hello from Claude"
        isStreaming={false}
        timestamp={new Date()}
        provider="claude"
        onCopy={() => {}}
      />,
    );
    expect(screen.getByText('Hello from Claude')).toBeDefined();
  });

  it('renders without a background bubble (transparent)', () => {
    const { container } = render(
      <AssistantMessage
        content="No bubble"
        isStreaming={false}
        timestamp={new Date()}
        provider="claude"
        onCopy={() => {}}
      />,
    );
    const wrapper = container.querySelector('[data-testid="assistant-message"]');
    expect(wrapper).toBeDefined();
    expect(wrapper!.className).not.toContain('bg-blue');
    expect(wrapper!.className).not.toContain('bg-white');
  });

  it('shows streaming indicator when isStreaming is true', () => {
    const { container } = render(
      <AssistantMessage
        content="Thinking..."
        isStreaming={true}
        timestamp={new Date()}
        provider="claude"
        onCopy={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="streaming-indicator"]')).toBeDefined();
  });

  it('does not show streaming indicator when isStreaming is false', () => {
    const { container } = render(
      <AssistantMessage
        content="Done"
        isStreaming={false}
        timestamp={new Date()}
        provider="claude"
        onCopy={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="streaming-indicator"]')).toBeNull();
  });

  it('shows copy button on hover', () => {
    const onCopy = vi.fn();
    render(
      <AssistantMessage
        content="Copy me"
        isStreaming={false}
        timestamp={new Date()}
        provider="claude"
        onCopy={onCopy}
      />,
    );
    const copyButton = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('shows thinking block when reasoning is provided and showThinking is true', () => {
    render(
      <AssistantMessage
        content="Answer"
        isStreaming={false}
        timestamp={new Date()}
        provider="claude"
        reasoning="Let me think about this..."
        showThinking={true}
        onCopy={() => {}}
      />,
    );
    expect(screen.getByText(/let me think about this/i)).toBeDefined();
  });

  it('hides thinking block when showThinking is false', () => {
    render(
      <AssistantMessage
        content="Answer"
        isStreaming={false}
        timestamp={new Date()}
        provider="claude"
        reasoning="Hidden reasoning"
        showThinking={false}
        onCopy={() => {}}
      />,
    );
    expect(screen.queryByText(/hidden reasoning/i)).toBeNull();
  });
});
