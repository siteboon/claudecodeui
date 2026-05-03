import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import SkipLink from './SkipLink';

describe('SkipLink', () => {
  it('renders a skip-to-content link', () => {
    render(<SkipLink targetId="main-content" />);
    const link = screen.getByText('Skip to content');
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('is visually hidden by default but accessible', () => {
    render(<SkipLink targetId="main-content" />);
    const link = screen.getByText('Skip to content');
    expect(link.className).toContain('sr-only');
    expect(link.className).toContain('focus:not-sr-only');
  });
});
