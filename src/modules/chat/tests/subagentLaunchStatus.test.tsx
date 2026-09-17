import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SubagentPanel } from '@/modules/chat/tools/SubagentPanel';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import type { SubagentInfo, ToolResult } from '@/shared/types';

const createDiff = createCachedDiffCalculator();

const render = (toolResult: ToolResult | null, subagent?: SubagentInfo) =>
  renderToStaticMarkup(
    React.createElement(SubagentPanel, {
      toolInput: JSON.stringify({ subagent_type: 'Explore', description: 'Survey the repo' }, null, 2),
      toolResult,
      subagent,
      createDiff,
    }),
  );

/**
 * A live run never goes through the history reader, so the card has no
 * `subagent` metadata to read a status off — it falls back to the tool result.
 * For a background agent that result is only the launch acknowledgement, which
 * lands about a second after the Agent call, so the fallback used to flip the
 * card to "done" while the agent was still working.
 */
describe('a background agent card at the moment it launches', () => {
  it('stays running when only the async launch acknowledgement has arrived', () => {
    const markup = render({
      content: 'Async agent launched successfully. agentId: internal bookkeeping',
      isError: false,
      toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1' },
    });

    expect(markup).toContain('running');
    expect(markup).not.toContain('done');
  });

  it('settles a synchronous agent as soon as its result arrives', () => {
    const markup = render({
      content: 'The repo has two packages.',
      isError: false,
      toolUseResult: { agentId: 'a1' },
    });

    expect(markup).toContain('done');
    expect(markup).not.toContain('running');
  });

  it('defers to the status the server reports once it has one', () => {
    const markup = render(
      {
        content: 'The repo has two packages.',
        isError: false,
        toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1' },
      },
      { id: 'a1', status: 'completed' },
    );

    expect(markup).toContain('done');
    expect(markup).not.toContain('running');
  });

  it('shows a background agent whose run ended before it reported as having no result', () => {
    // Neither outcome is true here: the agent did not finish, and it is not
    // still working either — the process it ran in is gone. A spinner would
    // promise a result that is never coming; a check mark would claim one
    // that never arrived.
    const markup = render(
      {
        content: '',
        isError: false,
        toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1' },
      },
      { id: 'a1', status: 'stopped' },
    );

    expect(markup).toContain('no result');
    expect(markup).toContain('title="The run ended before this agent reported back"');
    expect(markup).not.toContain('running');
    expect(markup).not.toContain('done');
    expect(markup).not.toContain('lucide-circle-check');
  });
});
