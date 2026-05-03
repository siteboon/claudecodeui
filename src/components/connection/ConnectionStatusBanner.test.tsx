import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ConnectionStatusBanner from './ConnectionStatusBanner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ConnectionStatusBanner', () => {
  it('renders nothing when connected', () => {
    const { container } = render(
      <ConnectionStatusBanner isConnected={true} onRetry={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows disconnected banner when not connected', () => {
    render(<ConnectionStatusBanner isConnected={false} onRetry={() => {}} />);
    expect(screen.getByText('connection.disconnected')).toBeDefined();
  });

  it('shows retry button', () => {
    render(<ConnectionStatusBanner isConnected={false} onRetry={() => {}} />);
    expect(screen.getByText('connection.retry')).toBeDefined();
  });

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ConnectionStatusBanner isConnected={false} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('connection.retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows reconnecting state', () => {
    render(<ConnectionStatusBanner isConnected={false} isReconnecting={true} onRetry={() => {}} />);
    expect(screen.getByText('connection.reconnecting')).toBeDefined();
  });

  it('disables retry button while reconnecting', () => {
    render(<ConnectionStatusBanner isConnected={false} isReconnecting={true} onRetry={() => {}} />);
    const btn = screen.getByText('connection.reconnecting').closest('button');
    expect(btn?.hasAttribute('disabled')).toBe(true);
  });
});
