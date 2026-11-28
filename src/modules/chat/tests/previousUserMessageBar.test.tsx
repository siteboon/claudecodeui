import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import { PreviousUserMessageBar } from '@/modules/chat/transcript/PreviousUserMessageBar';
import type { ChatMessage } from '@/shared/types';

/**
 * The bar names the prompt whose turn the reader is inside: the newest user
 * row that has scrolled completely above the transcript's top edge, else the
 * newest prompt the loaded rows hold, else the one read from the transcript
 * when a long turn pushed every prompt past the first page. These cases pin
 * that choice, the jump it offers, and the asides it must never name.
 */

const CONTAINER_TOP = 100;
const timestampOf = (value: string) => value.startsWith('t') ? `2026-11-27T00:00:0${value.slice(1)}.000Z` : value;

const userMessage = (timestamp: string, content: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'user',
  content,
  timestamp: timestampOf(timestamp),
  ...overrides,
});

const assistantMessage = (timestamp: string): ChatMessage => ({
  type: 'assistant',
  content: 'reply',
  timestamp: timestampOf(timestamp),
});

type RowBox = { element: HTMLDivElement; bottom: number };

const rect = (top: number, bottom: number): DOMRect => ({
  top,
  bottom,
  left: 0,
  right: 0,
  width: 0,
  height: bottom - top,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

const mountedContainers: HTMLDivElement[] = [];

/** A stand-in for the scrolling transcript: a container top edge plus one row per timestamp. */
function makeContainer(rows: Array<{ timestamp: string; bottom: number; id?: string }>): {
  container: HTMLDivElement;
  rows: Record<string, RowBox>;
} {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => rect(CONTAINER_TOP, CONTAINER_TOP + 600);
  const boxes: Record<string, RowBox> = {};

  for (const row of rows) {
    const element = document.createElement('div');
    element.setAttribute('data-message-timestamp', timestampOf(row.timestamp));
    if (row.id) element.setAttribute('data-message-id', row.id);
    const key = row.id ?? row.timestamp;
    boxes[key] = { element, bottom: row.bottom };
    element.getBoundingClientRect = () => rect(boxes[key].bottom - 20, boxes[key].bottom);
    container.appendChild(element);
  }

  document.body.appendChild(container);
  mountedContainers.push(container);
  return { container, rows: boxes };
}

const frames: FrameRequestCallback[] = [];

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  frames.length = 0;
  vi.unstubAllGlobals();
  for (const container of mountedContainers.splice(0)) {
    container.remove();
  }
});

describe('the previous user message bar', () => {
  it('shows the newest prompt scrolled above the viewport, and jumps to it when clicked', () => {
    const { container } = makeContainer([
      { timestamp: 't1', bottom: 60 },
      { timestamp: 't2', bottom: 220 },
      { timestamp: 't3', bottom: 500 },
      { timestamp: 't4', bottom: 700 },
    ]);
    const messages = [
      userMessage('t1', '第一条提问：帮我把提交拆开'),
      assistantMessage('t2'),
      userMessage('t3', '第二条提问'),
      assistantMessage('t4'),
    ];
    const onReveal = vi.fn();

    render(
      <PreviousUserMessageBar
        scrollContainerRef={{ current: container }}
        messages={messages}
        latestUserPrompt={null}
        onReveal={onReveal}
      />,
    );

    const bar = screen.getByTitle('Jump to the previous message you sent');
    expect(bar.textContent).toContain('Previous message');
    expect(bar.textContent).toContain('第一条提问：帮我把提交拆开');

    fireEvent.click(bar);
    expect(onReveal).toHaveBeenCalledWith(messages[0]);
  });

  it('keeps the newest prompt in reach while it is still on screen, and jumps to it', () => {
    const { container } = makeContainer([
      { timestamp: 't1', bottom: 300 },
      { timestamp: 't2', bottom: 700 },
    ]);
    const messages = [userMessage('t1', '还在屏幕里'), assistantMessage('t2')];
    const onReveal = vi.fn();

    render(
      <PreviousUserMessageBar
        scrollContainerRef={{ current: container }}
        // An older transcript read must lose to the prompt the reader can see.
        messages={messages}
        latestUserPrompt={userMessage('t0', '更早的提问')}
        onReveal={onReveal}
      />,
    );

    const bar = screen.getByTitle('Jump to the previous message you sent');
    expect(bar.textContent).toContain('还在屏幕里');
    expect(bar.textContent).not.toContain('更早的提问');

    fireEvent.click(bar);
    expect(onReveal).toHaveBeenCalledWith(messages[0]);
  });

  it('falls back to the prompt read from the transcript when no loaded row is one', () => {
    const { container } = makeContainer([
      { timestamp: 't1', bottom: 300 },
      { timestamp: 't2', bottom: 700 },
    ]);
    // A long turn: the tail page holds only this turn's assistant and tool rows.
    const messages = [assistantMessage('t1'), assistantMessage('t2')];
    const transcriptPrompt = userMessage('t3', '这一轮开始时我提的问题');
    const onReveal = vi.fn();

    render(
      <PreviousUserMessageBar
        scrollContainerRef={{ current: container }}
        messages={messages}
        latestUserPrompt={transcriptPrompt}
        latestUserPromptBoundary={{ timestamp: timestampOf('t1') }}
        onReveal={onReveal}
      />,
    );

    const bar = screen.getByTitle('Jump to the previous message you sent');
    expect(bar.textContent).toContain('这一轮开始时我提的问题');

    fireEvent.click(bar);
    expect(onReveal).toHaveBeenCalledWith(transcriptPrompt);
  });

  it('moves to the earlier prompt once the current one scrolls past the top', async () => {
    const { container, rows } = makeContainer([
      { timestamp: 't1', bottom: 60 },
      { timestamp: 't2', bottom: 240 },
      { timestamp: 't3', bottom: 320 },
      { timestamp: 't4', bottom: 520 },
    ]);
    const messages = [
      userMessage('t1', '最早的一条'),
      assistantMessage('t2'),
      userMessage('t3', '较新的一条'),
      assistantMessage('t4'),
    ];

    render(
      <PreviousUserMessageBar
        scrollContainerRef={{ current: container }}
        messages={messages}
        latestUserPrompt={null}
        onReveal={() => {}}
      />,
    );
    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('最早的一条');

    // The reader scrolls far enough that the newer prompt is above the edge too.
    rows.t2.bottom = 50;
    rows.t3.bottom = 90;
    fireEvent.scroll(container);
    await act(async () => {
      frames.splice(0).forEach((callback) => callback(0));
    });

    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('较新的一条');
  });

  it('阅读第一轮时显示当前提问，不能跳到已加载的下一轮', () => {
    const { container } = makeContainer([
      { timestamp: 't1', bottom: 300 },
      { timestamp: 't2', bottom: 500 },
      { timestamp: 't3', bottom: 900 },
    ]);
    const messages = [userMessage('t1', '这个窗口是哪个应用在弹'), assistantMessage('t2'), userMessage('t3', '我已经把设置关了')];
    const onReveal = vi.fn();
    render(<PreviousUserMessageBar scrollContainerRef={{ current: container }} messages={messages} latestUserPrompt={messages[2]} onReveal={onReveal} />);
    const bar = screen.getByTitle('Jump to the previous message you sent');
    expect(bar.textContent).toContain('这个窗口是哪个应用在弹');
    expect(bar.textContent).not.toContain('我已经把设置关了');
    fireEvent.click(bar);
    expect(onReveal).toHaveBeenCalledWith(messages[0]);
  });

  it('用户与回复时间戳相同时，仍按不同的消息行定位', () => {
    const { container } = makeContainer([
      { timestamp: 't1', bottom: 60, id: 'u1' },
      { timestamp: 't1', bottom: 300, id: 'a1' },
      { timestamp: 't2', bottom: 900, id: 'u2' },
    ]);
    const messages = [userMessage('t1', '当前轮次', { sourceMessageId: 'u1' }),
      { ...assistantMessage('t1'), sourceMessageId: 'a1' },
      userMessage('t2', '后续轮次', { sourceMessageId: 'u2' })];
    const onViewportChange = vi.fn();
    render(<PreviousUserMessageBar scrollContainerRef={{ current: container }} messages={messages} latestUserPrompt={null} onViewportChange={onViewportChange} onReveal={() => {}} />);
    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('当前轮次');
    expect(onViewportChange).toHaveBeenCalledWith(timestampOf('t1'), 'a1');
  });

  it('旧提问离开渲染窗口后，仍从当前回复之前查找', () => {
    const { container } = makeContainer([{ timestamp: 't2', bottom: 300 }, { timestamp: 't3', bottom: 900 }]);
    const messages = [userMessage('t1', '已退出渲染窗口的提问'), assistantMessage('t2'), userMessage('t3', '下面的提问')];
    render(<PreviousUserMessageBar scrollContainerRef={{ current: container }} messages={messages} latestUserPrompt={null} onReveal={() => {}} />);
    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('已退出渲染窗口的提问');
  });

  it('仅加载后续提问时，也按旧回复的边界回读并拒绝未来结果', () => {
    const { container } = makeContainer([{ timestamp: 't2', bottom: 300 }, { timestamp: 't3', bottom: 900 }]);
    const messages = [assistantMessage('t2'), userMessage('t3', '后续提问')];
    const onViewportChange = vi.fn();
    const { rerender } = render(<PreviousUserMessageBar scrollContainerRef={{ current: container }} messages={messages} latestUserPrompt={messages[1]} onViewportChange={onViewportChange} onReveal={() => {}} />);
    expect(screen.queryByTitle('Jump to the previous message you sent')).toBeNull();
    expect(onViewportChange).toHaveBeenCalledWith(timestampOf('t2'), undefined);
    rerender(<PreviousUserMessageBar scrollContainerRef={{ current: container }} messages={messages} latestUserPrompt={userMessage('t1', '跨页找到的前一条提问')} latestUserPromptBoundary={{ timestamp: timestampOf('t2') }} onReveal={() => {}} />);
    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('跨页找到的前一条提问');
  });

  it('never names the compaction summary that opens a continued session', () => {
    const { container } = makeContainer([
      { timestamp: 't1', bottom: 300 },
      { timestamp: 't2', bottom: 500 },
      { timestamp: 't3', bottom: 700 },
    ]);
    const messages = [
      userMessage('t1', '真正的问题'),
      assistantMessage('t2'),
      // The CLI sends the continued-session summary through the user turn, so
      // it arrives typed as one even though nobody wrote it.
      userMessage('t3', 'This session is being continued from a previous conversation that ran out of context.'),
    ];

    render(
      <PreviousUserMessageBar
        scrollContainerRef={{ current: container }}
        messages={messages}
        latestUserPrompt={null}
        onReveal={() => {}}
      />,
    );

    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('真正的问题');
    expect(screen.getByTitle('Jump to the previous message you sent').textContent).not.toContain('continued from');
  });

  it('never names a slash command as the session prompt', () => {
    const { container } = makeContainer([
      { timestamp: 't1', bottom: 300 },
      { timestamp: 't2', bottom: 600 },
    ]);
    const messages = [
      userMessage('t1', '真正的提问'),
      assistantMessage('t2'),
      userMessage('t3', '/compact', { isLocalCommand: true, commandName: 'compact' }),
    ];

    render(
      <PreviousUserMessageBar
        scrollContainerRef={{ current: container }}
        messages={messages}
        latestUserPrompt={null}
        onReveal={() => {}}
      />,
    );

    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('真正的提问');
    expect(screen.getByTitle('Jump to the previous message you sent').textContent).not.toContain('/compact');
  });

  it('never offers a side question as the session prompt', () => {
    const { container } = makeContainer([
      { timestamp: 't1', bottom: 60 },
      { timestamp: 't2', bottom: 50 },
    ]);
    const messages = [
      userMessage('t1', '真正的提问'),
      userMessage('t2', '顺带问一句', {
        sideQuestion: { sideQuestionId: 'side-1', sessionId: 'session-1', status: 'done' },
      }),
    ];

    render(
      <PreviousUserMessageBar
        scrollContainerRef={{ current: container }}
        messages={messages}
        latestUserPrompt={null}
        onReveal={() => {}}
      />,
    );

    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('真正的提问');
    expect(screen.getByTitle('Jump to the previous message you sent').textContent).not.toContain('顺带问一句');
  });

  it('names an attachment-only turn instead of rendering an empty line', () => {
    const { container } = makeContainer([{ timestamp: 't1', bottom: 40 }]);

    render(
      <PreviousUserMessageBar
        scrollContainerRef={{ current: container }}
        messages={[userMessage('t1', '', { files: [{ name: 'spec.pdf' }] })]}
        latestUserPrompt={null}
        onReveal={() => {}}
      />,
    );

    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('Attachment message');
  });
});
