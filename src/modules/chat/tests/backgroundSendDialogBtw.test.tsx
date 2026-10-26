import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import BackgroundSendDialog from '@/modules/chat/composer/BackgroundSendDialog';

/**
 * Asked before sending over background work, the user can also ask the
 * question on the side instead: BTW answers it beside the session without
 * queueing it or stopping the work.
 */

const PROMPT = { work: ['Workflow frontend-architecture-audit', 'Agent Survey the repo'] };

describe('the BTW choice in the background-work send dialog', () => {
  it('answers "btw"', () => {
    const onResolve = vi.fn();
    render(<BackgroundSendDialog prompt={PROMPT} onResolve={onResolve} />);

    fireEvent.click(screen.getByRole('button', { name: 'BTW' }));

    // Mapped to strings first: an event passed along must not be deep-printed.
    expect(onResolve.mock.calls.map((args) => args.map((arg) => (typeof arg === 'string' ? arg : typeof arg)))).toEqual([['btw']]);
  });

  it('sits between Queue and Send anyway, so the destructive choice stays last', () => {
    render(<BackgroundSendDialog prompt={PROMPT} onResolve={() => {}} />);

    const names = within(screen.getByRole('dialog'))
      .getAllByRole('button')
      .map((button) => button.textContent?.trim() ?? '')
      .filter((name) => ['Cancel', 'Queue', 'BTW', 'Send anyway'].includes(name));

    expect(names).toEqual(['Cancel', 'Queue', 'BTW', 'Send anyway']);
  });
});
