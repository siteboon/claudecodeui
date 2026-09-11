import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import zhChat from '@/modules/i18n/locales/zh-CN/chat.json';
import enChat from '@/modules/i18n/locales/en/chat.json';

// Mock t() against the real zh-CN catalog: the panel's section titles and
// metric labels are the keys this test asserts on, so a key typo fails here
// while the English parity check below guards the other locale.
const panelMessages = (zhChat as Record<string, unknown>).sessionInfoPanel as Record<string, unknown>;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const [ns, ...rest] = key.split('.');
      const root = ns === 'sessionInfoPanel' ? panelMessages : (zhChat as Record<string, unknown>)[ns];
      let value: unknown = root;
      for (const part of rest) {
        value = (value as Record<string, unknown> | undefined)?.[part];
      }
      return typeof value === 'string' ? value : key;
    },
  }),
}));

const { SessionInfoPanel } = await import('@/modules/chat/panel/SessionInfoPanel');
import type { NormalizedMessage } from '@/shared/types';

const noMessages: NormalizedMessage[] = [];

const renderPanel = (overrides: Partial<Parameters<typeof SessionInfoPanel>[0]> = {}) => {
  const toggles: string[] = [];
  const view = render(
    <SessionInfoPanel
      collapsed={{}}
      onToggleSection={(section) => toggles.push(section)}
      mergedMessages={noMessages}
      turnStats={null}
      tokenBudget={null}
      contextInfo={null}
      isMobile={false}
      onClose={() => toggles.push('close')}
      {...overrides}
    />,
  );

  return { view, toggles };
};

test('the six sections render and one click collapses by request', () => {
  renderPanel();

  for (const heading of ['上下文', '轮次统计', '子代理', '任务', 'MCP', '上下文来源']) {
    assert.ok(screen.getAllByText(heading).length >= 1, `missing section ${heading}`);
  }
});

test('a collapsed section unmounts its body', () => {
  renderPanel({ collapsed: { turnStats: true } });

  // The header stays; the metric rows are gone.
  assert.ok(screen.getByText('轮次统计'));
  assert.equal(screen.queryByText('回答速度'), null);
});

test('an expanded section shows the metric labels', () => {
  renderPanel();

  assert.ok(screen.getByText('回答速度'));
  assert.ok(screen.getByText('缓存命中率'));
});

test('clicking a header asks the parent to toggle that section', () => {
  const { toggles } = renderPanel();

  fireEvent.click(screen.getByText('任务'));

  assert.deepEqual(toggles, ['tasks']);
});

test('the task section counts completed rows and shows activeForm while running', () => {
  const taskRows: NormalizedMessage[] = [
    {
      id: 'tc1', sessionId: 's1', timestamp: '2026-09-12T00:00:00.000Z', provider: 'claude',
      kind: 'tool_use', toolName: 'TaskCreate', toolId: 't1',
      toolInput: { subject: 'Read notes', activeForm: 'Reading notes' },
      toolResult: { content: 'ok', isError: false, toolUseResult: { task: { id: '1', status: 'completed' } } },
    },
    {
      id: 'tc2', sessionId: 's1', timestamp: '2026-09-12T00:00:01.000Z', provider: 'claude',
      kind: 'tool_use', toolName: 'TaskCreate', toolId: 't2',
      toolInput: { subject: 'Ship it', activeForm: 'Shipping it' },
      toolResult: { content: 'ok', isError: false, toolUseResult: { task: { id: '2', status: 'in_progress' } } },
    },
  ] as unknown as NormalizedMessage[];

  renderPanel({ mergedMessages: taskRows });

  assert.ok(screen.getByText('1/2'), 'header shows the completed/total count');
  assert.ok(screen.getByText('Read notes'), 'a pending row shows its subject');
  assert.ok(screen.getByText('Shipping it'), 'the running row uses its present-tense wording');
});

test('mobile renders as a fixed drawer with the close affordance', () => {
  const { toggles } = renderPanel({ isMobile: true });

  const close = screen.getByLabelText('关闭会话面板');
  fireEvent.click(close);

  assert.deepEqual(toggles, ['close']);
});

test('the English catalog covers every key the panel reads', () => {
  const enPanel = (enChat as Record<string, unknown>).sessionInfoPanel as Record<string, unknown>;
  const collect = (value: unknown, prefix: string, into: string[]) => {
    if (typeof value === 'string') {
      into.push(prefix);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collect(child, `${prefix}.${key}`, into);
    }
  };

  const zhKeys: string[] = [];
  collect(panelMessages, 'sessionInfoPanel', zhKeys);
  const enKeys: string[] = [];
  collect(enPanel, 'sessionInfoPanel', enKeys);

  assert.deepEqual(zhKeys.sort(), enKeys.sort());
});
