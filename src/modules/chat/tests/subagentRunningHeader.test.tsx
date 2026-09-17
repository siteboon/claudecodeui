import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SubagentPanel } from '@/modules/chat/tools/SubagentPanel';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import type { SubagentActivity, SubagentInfo } from '@/shared/types';

const createDiff = createCachedDiffCalculator();

const tool = (toolName: string): SubagentActivity => ({ kind: 'tool', toolName, toolId: toolName });

const render = (status: SubagentInfo['status'], activity: SubagentActivity[]) =>
  renderToStaticMarkup(
    React.createElement(SubagentPanel, {
      toolInput: JSON.stringify({ description: 'probe', prompt: 'do a thing' }),
      subagent: { id: 'a1', type: 'Explore', status },
      activity,
      createDiff,
    }),
  );

// The card is collapsed by default, so the header is the only thing a user sees
// while an agent runs. A bare "running" label there is what made a working
// session read as a frozen one.
describe('subagent card header while running', () => {
  it('shows how many tools have run and which one is current', () => {
    const html = render('running', [tool('Grep'), tool('Read'), tool('Bash')]);

    expect(html).toContain('3 tools');
    expect(html).toContain('Bash');
  });

  it('counts up as the agent works', () => {
    const before = render('running', [tool('Grep')]);
    const after = render('running', [tool('Grep'), tool('Read')]);

    expect(before).toContain('1 tool');
    expect(before).not.toContain('1 tools');
    expect(after).toContain('2 tools');
  });

  it('names only tool entries, ignoring text and thinking', () => {
    const html = render('running', [
      tool('Read'),
      { kind: 'thinking', content: 'hmm' },
      { kind: 'text', content: 'writing it up' },
    ]);

    // The agent's last *tool* is still Read; prose after it must not become the label.
    expect(html).toContain('1 tool');
    expect(html).toContain('Read');
    expect(html).not.toContain('writing it up');
  });

  it('falls back to "running" before the first tool, not "0 tools"', () => {
    const html = render('running', []);

    expect(html).toContain('running');
    expect(html).not.toContain('0 tools');
  });

  it('keeps the final count when the agent completes', () => {
    const html = render('completed', [tool('Grep'), tool('Read')]);

    expect(html).toContain('2 tools');
  });
});
