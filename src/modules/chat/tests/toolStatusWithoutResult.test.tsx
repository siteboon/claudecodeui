import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';

const createDiff = createCachedDiffCalculator();

const render = (toolStatus?: string) =>
  renderToStaticMarkup(
    React.createElement(ToolRenderer, {
      toolName: 'Read',
      toolInput: JSON.stringify({ file_path: '/tmp/demo/Header.tsx' }, null, 2),
      mode: 'input' as const,
      createDiff,
      toolStatus,
    }),
  );

// A Cursor IDE transcript records tool calls but never their results, so the
// history reports those calls as completed. Without that, every call in an old
// IDE chat would show a permanent "Running" badge.
describe('the status of a tool call without a result', () => {
  it('is running while nothing says otherwise', () => {
    expect(render()).toContain('Running');
  });

  it('is not running once the provider reports it completed', () => {
    expect(render('completed')).not.toContain('Running');
  });
});
