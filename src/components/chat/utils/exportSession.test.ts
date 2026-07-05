import assert from 'node:assert/strict';
import test from 'node:test';

import { exportSessionAsMarkdown } from './exportSession';

test('exportSessionAsMarkdown serializes visible chat messages', () => {
  const markdown = exportSessionAsMarkdown(
    [
      { type: 'user', content: 'Please inspect `src/app.ts`.', timestamp: '2026-07-05T00:00:00.000Z' },
      { type: 'assistant', content: 'Done.', timestamp: '2026-07-05T00:00:01.000Z' },
      {
        type: 'assistant',
        isToolUse: true,
        toolName: 'Read',
        toolInput: { file_path: 'src/app.ts' },
        timestamp: '2026-07-05T00:00:02.000Z',
      },
    ],
    'Session title',
  );

  assert.match(markdown, /^# Session title/);
  assert.match(markdown, /## User\n\nPlease inspect `src\/app\.ts`\./);
  assert.match(markdown, /## Assistant\n\nDone\./);
  assert.match(markdown, /## Tool: Read\n\n\{\n {2}"file_path": "src\/app\.ts"\n\}/);
});
