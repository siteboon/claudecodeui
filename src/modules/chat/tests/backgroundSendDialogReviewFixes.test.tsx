import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import BackgroundSendDialog from '@/modules/chat/composer/BackgroundSendDialog';

/**
 * A review fix on `BackgroundSendDialog`: an attachment-only composer (no
 * typed text) can still open this dialog during background work. Choosing
 * Side question there would pass an empty question to `useAskSideQuestion`,
 * which refuses it and shows nothing — the choice would appear to do
 * nothing. The dialog now takes `hasText`, defaulting to `true` so existing
 * callers and tests keep working, and leaves the Side question button out
 * when it is false, the same way it is already left out when the provider
 * does not support side questions.
 */

const PROMPT = { work: ['Workflow frontend-architecture-audit'] };

const allButtonNames = () => within(screen.getByRole('dialog'))
  .getAllByRole('button')
  .map((button) => button.textContent?.trim() ?? '')
  .filter((name) => name !== '');

describe('the background-work send dialog with an attachment-only composer', () => {
  it('has no side-question button when the composer has no typed text', () => {
    render(<BackgroundSendDialog prompt={PROMPT} supportsSideQuestions hasText={false} onResolve={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Side question' })).toBeNull();
    expect(allButtonNames()).toEqual(['Cancel', 'Queue', 'Send anyway']);
  });

  it('still shows the side-question button when hasText is left out, since the default is true', () => {
    render(<BackgroundSendDialog prompt={PROMPT} supportsSideQuestions onResolve={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Side question' })).not.toBeNull();
  });

  it('still shows the side-question button when there is typed text', () => {
    const onResolve = vi.fn();
    render(<BackgroundSendDialog prompt={PROMPT} supportsSideQuestions hasText onResolve={onResolve} />);

    expect(screen.queryByRole('button', { name: 'Side question' })).not.toBeNull();
  });
});
