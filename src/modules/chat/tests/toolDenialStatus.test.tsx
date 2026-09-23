import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '@/modules/i18n';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';

/**
 * A tool call the user refused shows an orange "Denied" badge, not the red
 * "Error" of a tool that ran and failed. The badge is inferred from the text of
 * the error tool result, so it must know every text a refusal can carry: the
 * CLI's own rejection (what a bare Deny ends up as), the runtime's denial that
 * relays a reason or refuses a subagent call, and the texts older transcripts
 * and the runtime's other deny paths still carry.
 */

const createDiff = createCachedDiffCalculator();

const CLI_REJECTION = "The user doesn't want to proceed with this tool use. The tool use was rejected "
  + '(eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing '
  + 'and wait for the user to tell you how to proceed.';
const DENIAL_WITH_REASON = 'The user denied permission to use Bash. The tool use was rejected (eg. if it '
  + 'was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user '
  + 'said:\nuse the staging bucket instead';
const SUBAGENT_DENIAL = 'The user denied permission to use Write. The tool use was rejected (eg. if it '
  + 'was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for '
  + 'the user to tell you how to proceed.';

// Rows of the three renderers that show a status badge: Bash's command row, a
// one-line tool and a collapsible tool.
const TOOLS: Array<[string, Record<string, unknown>]> = [
  ['Bash', { command: 'echo hi > marker.txt', description: 'Write a marker file' }],
  ['WebSearch', { query: 'staging bucket' }],
  ['Write', { file_path: '/tmp/demo/marker.txt', content: 'hi' }],
];

const renderBadge = (toolName: string, toolInput: Record<string, unknown>, content: string, isError = true) => {
  const markup = renderToStaticMarkup(
    React.createElement(ToolRenderer, {
      toolName,
      toolInput: JSON.stringify(toolInput, null, 2),
      toolResult: { content, isError },
      mode: 'input' as const,
      createDiff,
    }),
  );
  return {
    denied: markup.includes('>Denied</span>'),
    error: markup.includes('>Error</span>'),
  };
};

describe('status badge of a refused tool call', () => {
  const denialTexts: Array<[string, string]> = [
    ['a bare Deny (the CLI rejection text)', CLI_REJECTION],
    ['a Deny with a reason', DENIAL_WITH_REASON],
    ['a refused subagent call', SUBAGENT_DENIAL],
    ['a Deny in an older transcript', 'User denied tool use'],
    ['a tool disallowed by settings', 'Tool disallowed by settings'],
    ['a prompt left unanswered', 'Permission request timed out'],
    ['a prompt withdrawn by the runtime', 'Permission request cancelled'],
  ];

  for (const [toolName, toolInput] of TOOLS) {
    for (const [label, content] of denialTexts) {
      it(`${toolName}: ${label} shows Denied`, () => {
        expect(renderBadge(toolName, toolInput, content)).toEqual({ denied: true, error: false });
      });
    }

    it(`${toolName}: a tool that ran and failed still shows Error`, () => {
      expect(renderBadge(toolName, toolInput, 'Exit code 1\nNo such file or directory'))
        .toEqual({ denied: false, error: true });
    });
  }
});
