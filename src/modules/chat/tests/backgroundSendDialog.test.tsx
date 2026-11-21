import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import BackgroundSendDialog from '@/modules/chat/composer/BackgroundSendDialog';

const PROMPT = { work: ['Workflow frontend-architecture-audit', 'Agent Survey the repo'] };

describe('the background-work send dialog', () => {
  it('lists the work and focuses Cancel on open, so an accidental Enter cancels', async () => {
    render(<BackgroundSendDialog prompt={PROMPT} onResolve={() => {}} />);

    expect(screen.getByText('Workflow frontend-architecture-audit')).toBeTruthy();
    expect(screen.getByText('Agent Survey the repo')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });
  });

  it('maps each button to its choice', () => {
    const onResolve = vi.fn();
    render(<BackgroundSendDialog prompt={PROMPT} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }));

    expect(onResolve.mock.calls).toEqual([['cancel'], ['queue'], ['send']]);
  });

  it('cancels on Escape and on a click outside', () => {
    const onResolve = vi.fn();
    render(<BackgroundSendDialog prompt={PROMPT} onResolve={onResolve} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    const overlay = document.querySelector('[role="dialog"]')?.previousElementSibling;
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay as Element);

    expect(onResolve.mock.calls).toEqual([['cancel'], ['cancel']]);
  });

  it('renders nothing while no prompt is open', () => {
    render(<BackgroundSendDialog prompt={null} onResolve={() => {}} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
