import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import UserMessage from './UserMessage';

describe('UserMessage', () => {
  it('renders message content in a bubble', () => {
    render(<UserMessage content="Hello world" timestamp={new Date('2025-06-01T12:00:00Z')} />);
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('renders timestamp below the bubble', () => {
    render(<UserMessage content="Test" timestamp={new Date('2025-06-01T14:30:00Z')} />);
    const timeEl = screen.getByTestId('user-message-timestamp');
    expect(timeEl).toBeDefined();
  });

  it('uses warm bubble styling (not blue)', () => {
    const { container } = render(
      <UserMessage content="Warm bubble" timestamp={new Date()} />,
    );
    const bubble = container.querySelector('[data-testid="user-message-bubble"]');
    expect(bubble).toBeDefined();
    expect(bubble!.className).toContain('user-bubble');
    expect(bubble!.className).not.toContain('bg-blue');
  });

  it('renders file chips when files are provided', () => {
    const files = [{ name: 'report.pdf', size: 1024, type: 'application/pdf' }];
    render(<UserMessage content="See attached" timestamp={new Date()} files={files} />);
    expect(screen.getByText('report.pdf')).toBeDefined();
  });

  it('renders images when provided', () => {
    const images = ['https://example.com/img.png'];
    const { container } = render(
      <UserMessage content="Look at this" timestamp={new Date()} images={images} />,
    );
    const img = container.querySelector('img');
    expect(img).toBeDefined();
    expect(img!.getAttribute('src')).toBe('https://example.com/img.png');
  });

  it('does not render file chips section when no files', () => {
    const { container } = render(
      <UserMessage content="No files" timestamp={new Date()} />,
    );
    expect(container.querySelector('[data-testid="user-message-files"]')).toBeNull();
  });
});
