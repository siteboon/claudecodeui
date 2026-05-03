import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import SessionProviderLogo from './SessionProviderLogo';

describe('SessionProviderLogo', () => {
  test('renders without crashing for openclaude provider', () => {
    render(<SessionProviderLogo provider="openclaude" />);
    // Should not render the default Claude logo — should render an openclaude-specific element
    const container = document.querySelector('svg, img');
    expect(container).toBeTruthy();
  });

  test('renders distinct element for openclaude vs claude', () => {
    const { container: openclaudeContainer } = render(
      <SessionProviderLogo provider="openclaude" />,
    );
    const { container: claudeContainer } = render(
      <SessionProviderLogo provider="claude" />,
    );
    // The innerHTML should differ (different logo components)
    expect(openclaudeContainer.innerHTML).not.toBe(claudeContainer.innerHTML);
  });

  test('renders groq logo for groq (regression check)', () => {
    render(<SessionProviderLogo provider="groq" />);
    expect(screen.getByAltText('Groq')).toBeInTheDocument();
  });
});
