import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SubagentPanel } from '@/modules/chat/tools/SubagentPanel';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import type { SubagentActivity, SubagentInfo } from '@/shared/types';

const createDiff = createCachedDiffCalculator();

let seq = 0;
const tool = (toolName: string): SubagentActivity => ({
  kind: 'tool',
  toolName,
  toolId: `${toolName}-${(seq += 1)}`,
  // Real entries carry the tool's arguments; the timeline renders them, so a
  // fixture without them tests a shape that never reaches the UI.
  toolInput: { pattern: 'x', file_path: '/tmp/x', command: 'echo x' },
});

/** An entry whose input never arrived — the shape that used to crash the pane. */
const toolWithoutInput = (toolName: string): SubagentActivity => ({ kind: 'tool', toolName, toolId: `bare-${toolName}` });

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

    // The agent's last *tool* is still Read; prose after it must not become the
    // label. Scoped to the header — the prose legitimately appears further down,
    // in the timeline the card now opens with.
    const header = html.slice(0, html.indexOf('</button>'));
    expect(header).toContain('1 tool');
    expect(header).toContain('Read');
    expect(header).not.toContain('writing it up');
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

// The card opens itself while the agent works. What made this worth measuring
// rather than arguing about: the timeline is capped at
// INITIALLY_RENDERED_ACTIVITIES, so the cost is flat past ~25 entries —
// 4ms and 46KB whether the agent ran 50 tools or 500.
describe('subagent card opening', () => {
  it('shows the timeline while the agent is running', () => {
    const html = render('running', [tool('Grep'), tool('Read')]);

    expect(html).toContain('aria-expanded="true"');
  });

  it('stays closed for an agent that is already done', () => {
    const html = render('completed', [tool('Grep'), tool('Read')]);

    expect(html).toContain('aria-expanded="false"');
  });

  it('stays closed for a failed agent, whose result is the summary', () => {
    const html = render('failed', [tool('Grep')]);

    expect(html).toContain('aria-expanded="false"');
  });

  it('costs the same open whether the agent ran ten tools or hundreds', () => {
    const few = render('running', Array.from({ length: 10 }, () => tool('Bash')));
    const many = render('running', Array.from({ length: 400 }, () => tool('Bash')));

    // Not a timing assertion — a structural one. If the cap is ever removed,
    // the rendered size stops being flat and this fails.
    expect(Math.abs(many.length - few.length) / few.length).toBeLessThan(3);
  });
});

describe('a malformed timeline entry', () => {
  it('renders instead of taking the chat pane down', () => {
    const html = renderToStaticMarkup(
    React.createElement(SubagentPanel, {
      toolInput: JSON.stringify({ description: 'probe', prompt: 'x' }),
      subagent: { id: 'a1', type: 'Explore', status: 'running' },
        activity: [toolWithoutInput('Grep'), toolWithoutInput('Read')],
        createDiff,
      }),
    );

    expect(html).toContain('aria-expanded="true"');
  });
});
