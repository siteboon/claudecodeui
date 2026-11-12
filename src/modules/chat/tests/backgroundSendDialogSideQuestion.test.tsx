import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import BackgroundSendDialog from '@/modules/chat/composer/BackgroundSendDialog';

/**
 * Asked before sending over background work, the user can also ask the
 * question on the side instead: a side question answers it beside the session
 * without queueing it or stopping the work. Only a provider that can answer
 * side questions gets that button; the default is false until the capability
 * matrix has loaded.
 */

const PROMPT = { work: ['Workflow frontend-architecture-audit', 'Agent Survey the repo'] };

const buttonNames = () => within(screen.getByRole('dialog'))
  .getAllByRole('button')
  .map((button) => button.textContent?.trim() ?? '')
  .filter((name) => ['Cancel', 'Queue', 'Side question', 'Send anyway'].includes(name));

// Unfiltered, so a side-question button under any label still shows up.
const allButtonNames = () => within(screen.getByRole('dialog'))
  .getAllByRole('button')
  .map((button) => button.textContent?.trim() ?? '')
  .filter((name) => name !== '');

describe('the side-question choice in the background-work send dialog', () => {
  it('answers "sideQuestion"', () => {
    const onResolve = vi.fn();
    render(<BackgroundSendDialog prompt={PROMPT} supportsSideQuestions onResolve={onResolve} />);

    fireEvent.click(screen.getByRole('button', { name: 'Side question' }));

    // Mapped to strings first: an event passed along must not be deep-printed.
    expect(onResolve.mock.calls.map((args) => args.map((arg) => (typeof arg === 'string' ? arg : typeof arg)))).toEqual([['sideQuestion']]);
  });

  it('sits between Queue and Send anyway, so the destructive choice stays last', () => {
    render(<BackgroundSendDialog prompt={PROMPT} supportsSideQuestions onResolve={() => {}} />);

    expect(buttonNames()).toEqual(['Cancel', 'Queue', 'Side question', 'Send anyway']);
  });
});

describe('the background-work send dialog without side-question support', () => {
  it('has no side-question button when the provider cannot answer one', () => {
    render(<BackgroundSendDialog prompt={PROMPT} supportsSideQuestions={false} onResolve={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Side question' })).toBeNull();
    expect(allButtonNames()).toEqual(['Cancel', 'Queue', 'Send anyway']);
  });

  it('has no side-question button before the capability matrix has loaded', () => {
    render(<BackgroundSendDialog prompt={PROMPT} onResolve={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Side question' })).toBeNull();
    expect(allButtonNames()).toEqual(['Cancel', 'Queue', 'Send anyway']);
  });
});
