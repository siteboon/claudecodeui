import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import { TranscriptRenderContext } from '@/modules/chat/context/TranscriptRenderContext';
import { SubagentPanel } from '@/modules/chat/tools/SubagentPanel';

// A brief of the length issue #1305 was about: well past the six lines the
// card shows before its toggle.
const LONG_PROMPT = [
  'You are reviewing pull request #42.',
  '',
  'Do the following, in order:',
  ...Array.from({ length: 10 }, (_, index) => `${index + 1}. Check part ${index + 1} of the diff.`),
  '',
  'Last line: report a verdict, then one bullet per finding.',
].join('\n');

const agentInput = (prompt: string) =>
  JSON.stringify({ subagent_type: 'general-purpose', description: 'Review the diff', prompt });

/** Opens the agent card, whose header is the only button until then. */
const openCard = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

/**
 * jsdom lays nothing out, so every box reports a height of 0. Report the
 * clamped task the way a browser does for a brief longer than the clamp.
 */
const layOutAsOverflowing = () => {
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(240);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(96);
};

describe('an agent card\'s task', () => {
  it('can be read in full when the clamp hides part of it', () => {
    layOutAsOverflowing();
    render(<SubagentPanel toolInput={agentInput(LONG_PROMPT)} createDiff={() => []} />);
    openCard();

    const task = screen.getByText(/You are reviewing pull request #42\./);
    expect(task.textContent).toBe(LONG_PROMPT);
    // A summary first: the brief should not push the agent's steps away.
    expect(task.className).toContain('line-clamp-6');

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(task.className).not.toContain('line-clamp');

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(task.className).toContain('line-clamp-6');
  });

  it('offers no toggle when the whole task already fits', () => {
    render(<SubagentPanel toolInput={agentInput('List the packages in the repo.')} createDiff={() => []} />);
    openCard();

    expect(screen.getByText('List the packages in the repo.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('is exported whole, since nothing in the file can expand it', () => {
    const markup = renderToStaticMarkup(
      <TranscriptRenderContext.Provider value={{ isExporting: true }}>
        <SubagentPanel toolInput={agentInput(LONG_PROMPT)} createDiff={() => []} />
      </TranscriptRenderContext.Provider>,
    );

    expect(markup).toContain('Last line: report a verdict, then one bullet per finding.');
    expect(markup).not.toContain('line-clamp');
    expect(markup).not.toContain('Show more');
  });
});
