import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import { PreviousUserMessageBar } from '@/modules/chat/transcript/PreviousUserMessageBar';
import type { ChatMessage } from '@/shared/types';

/**
 * The bar names the prompt whose turn the reader is inside: the newest user
 * row that has scrolled completely above the transcript's top edge. These
 * cases pin that choice, the jump it offers, and the cases it must stay out of
 * (a prompt still on screen, a side-question aside).
 */

const CONTAINER_TOP = 100;

const userMessage = (timestamp: string, content: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  type: 'user',
  content,
  timestamp,
  ...overrides,
});

const assistantMessage = (timestamp: string): ChatMessage => ({
  type: 'assistant',
  content: 'reply',
  timestamp,
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
function makeContainer(rows: Array<{ timestamp: string; bottom: number }>): {
  container: HTMLDivElement;
  rows: Record<string, RowBox>;
} {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => rect(CONTAINER_TOP, CONTAINER_TOP + 600);
  const boxes: Record<string, RowBox> = {};

  for (const row of rows) {
    const element = document.createElement('div');
    element.setAttribute('data-message-timestamp', row.timestamp);
    boxes[row.timestamp] = { element, bottom: row.bottom };
    element.getBoundingClientRect = () => rect(boxes[row.timestamp].bottom - 20, boxes[row.timestamp].bottom);
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
        onReveal={onReveal}
      />,
    );

    const bar = screen.getByTitle('Jump to the previous message you sent');
    expect(bar.textContent).toContain('Previous message');
    expect(bar.textContent).toContain('第一条提问：帮我把提交拆开');

    fireEvent.click(bar);
    expect(onReveal).toHaveBeenCalledWith(messages[0]);
  });

  it('stays out of the way while every prompt is still on screen', () => {
    const { container } = makeContainer([
      { timestamp: 't1', bottom: 300 },
      { timestamp: 't2', bottom: 700 },
    ]);

    render(
      <PreviousUserMessageBar
        scrollContainerRef={{ current: container }}
        messages={[userMessage('t1', '还在屏幕里'), assistantMessage('t2')]}
        onReveal={() => {}}
      />,
    );

    expect(screen.queryByTitle('Jump to the previous message you sent')).toBeNull();
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
        onReveal={() => {}}
      />,
    );
    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('最早的一条');

    // The reader scrolls far enough that the newer prompt is above the edge too.
    rows.t3.bottom = 90;
    fireEvent.scroll(container);
    await act(async () => {
      frames.splice(0).forEach((callback) => callback(0));
    });

    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('较新的一条');
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
        onReveal={() => {}}
      />,
    );

    expect(screen.getByTitle('Jump to the previous message you sent').textContent).toContain('Attachment message');
  });
});
