import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import type { ChatMessage, ToolGroupItem } from '@/shared/types';

const createDiff = createCachedDiffCalculator();

// `normalizedToChatMessages` serializes tool arguments, so every renderer in
// the app receives a JSON string here — never the object literal it is easier
// to write in a test. Building these through one helper keeps the fixtures
// honest: an earlier version of this file passed objects, and the group total
// silently rendered nothing in the real app while the test passed.
const serializeToolInput = (toolInput: Record<string, unknown>) =>
  JSON.stringify(toolInput, null, 2);

const render = (toolName: string, toolInput: Record<string, unknown>) =>
  renderToStaticMarkup(
    React.createElement(ToolRenderer, {
      toolName,
      toolInput: serializeToolInput(toolInput),
      mode: 'input' as const,
      createDiff,
    }),
  );

// The counts live in the collapsible header, which stays rendered (and sticky)
// whether or not the diff below it is expanded — that is the whole point, since
// these rows are collapsed by default.
describe('diff stats in the tool header', () => {
  it('shows added and removed counts for an Edit', () => {
    const markup = render('Edit', {
      file_path: '/tmp/demo/math.js',
      old_string: 'const a = 1;\nconst b = 2;\nconst c = 3;',
      new_string: 'const a = 1;\nconst b = 20;\nconst c = 3;\nconst d = 4;',
    });

    // Matched with the surrounding tags: '-1' on its own also appears inside
    // Tailwind class names like `-mx-1`.
    expect(markup).toContain('>+2</span>');
    expect(markup).toContain('>-1</span>');
    expect(markup).toContain('2 lines added, 1 removed');
  });

  it('shows only additions for a Write, because the file did not exist', () => {
    const markup = render('Write', {
      file_path: '/tmp/demo/new.js',
      content: 'one\ntwo\nthree',
    });

    expect(markup).toContain('>+3</span>');
    expect(markup).not.toMatch(/>-\d+<\/span>/);
    expect(markup).toContain('3 lines added, 0 removed');
  });

  it('shows nothing for an edit that replaces text with itself', () => {
    const markup = render('Edit', {
      file_path: '/tmp/demo/math.js',
      old_string: 'unchanged',
      new_string: 'unchanged',
    });

    expect(markup).not.toContain('lines added');
  });

  it('leaves tools that render no diff without a stats badge', () => {
    const markup = render('Read', { file_path: '/tmp/demo/math.js' });

    expect(markup).not.toContain('lines added');
  });
});

// A run of consecutive same-tool calls collapses into one row showing `x4` and
// a filename. Without a total, the collapsed row says nothing about how large
// the batch of edits actually is.
describe('diff stats on a collapsed tool group', () => {
  const editMessage = (oldString: string, newString: string): ChatMessage => ({
    type: 'assistant',
    content: '',
    timestamp: new Date('2026-08-23T00:00:00.000Z'),
    isToolUse: true,
    toolName: 'Edit',
    toolInput: serializeToolInput({
      file_path: '/tmp/demo/a.js',
      old_string: oldString,
      new_string: newString,
    }),
  } as unknown as ChatMessage);

  const renderGroup = (toolName: string, messages: ChatMessage[]) => {
    const group = {
      _isGroup: true,
      toolName,
      messages,
      timestamp: messages[0].timestamp,
      preview: 'a.js',
    } as ToolGroupItem;

    return renderToStaticMarkup(
      React.createElement(ToolGroupContainer, {
        group,
        prevMessage: null,
        createDiff,
        getMessageKey: (message: ChatMessage) => String(message.timestamp),
        provider: 'claude' as const,
      }),
    );
  };

  it('totals the added and removed lines across the group', () => {
    const markup = renderGroup('Edit', [
      editMessage('a\nb', 'a\nB'),
      editMessage('one\ntwo\nthree', 'one\ntwo\nthree\nfour\nfive'),
    ]);

    expect(markup).toContain('3 lines added, 1 removed');
  });

  it('leaves a group of non-diff tools without a total', () => {
    const readMessage = {
      type: 'assistant',
      content: '',
      timestamp: new Date('2026-08-23T00:00:00.000Z'),
      isToolUse: true,
      toolName: 'Read',
      toolInput: serializeToolInput({ file_path: '/tmp/demo/a.js' }),
    } as unknown as ChatMessage;

    expect(renderGroup('Read', [readMessage, readMessage])).not.toContain('lines added');
  });
});
