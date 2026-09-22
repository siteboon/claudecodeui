import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import type { KeyboardEvent, RefObject } from 'react';

import type { Project, SlashCommand } from '@/shared/types';

/**
 * Regression guard for #1185: Tab on a highlighted slash-command suggestion
 * executed the command straight away, so a command declaring `argument-hint`
 * could never be given an argument. Tab must only complete "<name> " into the
 * input; Enter stays the key that runs it.
 */

const jsonResponse = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
});

const listCommands = vi.fn();
const listSkills = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    commands: { list: (...args: unknown[]) => listCommands(...args) },
    providers: { skills: (...args: unknown[]) => listSkills(...args) },
  },
}));

const { useSlashCommands } = await import('@/modules/chat/hooks/useSlashCommands');

const project: Project = {
  projectId: 'triage-repo',
  displayName: 'triage-repo',
  fullPath: '/home/triage/work/triage-repo',
};

const FIREWALL_COMMAND = '/firewall-reload';

const keyEvent = (key: string) => {
  let defaultPrevented = false;
  return {
    event: {
      key,
      preventDefault: () => {
        defaultPrevented = true;
      },
    } as unknown as KeyboardEvent<HTMLTextAreaElement>,
    wasPrevented: () => defaultPrevented,
  };
};

const setUp = async (typedInput: string) => {
  const setInputCalls: string[] = [];
  const executedCommands: SlashCommand[] = [];
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  const textareaRef = { current: textarea } as RefObject<HTMLTextAreaElement>;

  const { result, rerender } = renderHook(
    ({ input }: { input: string }) =>
      useSlashCommands({
        selectedProject: project,
        provider: 'claude',
        input,
        setInput: (value) => {
          setInputCalls.push(value as string);
        },
        textareaRef,
        onExecuteCommand: (command) => {
          executedCommands.push(command);
        },
      }),
    { initialProps: { input: '' } },
  );

  await waitFor(() => assert.equal(result.current.slashCommandsCount, 2));

  // Mirror the composer: the textarea reports the typed text, then the hook is
  // told where the caret is so it can open and filter the menu.
  textarea.value = typedInput;
  textarea.setSelectionRange(typedInput.length, typedInput.length);
  rerender({ input: typedInput });
  act(() => {
    result.current.handleCommandInputChange(typedInput, typedInput.length);
  });

  await waitFor(() => {
    assert.equal(result.current.showCommandMenu, true);
    assert.deepEqual(
      result.current.filteredCommands.map((command) => command.name),
      [FIREWALL_COMMAND],
    );
  });

  return { result, setInputCalls, executedCommands, textarea };
};

beforeEach(() => {
  localStorage.clear();
  listCommands.mockReset();
  listSkills.mockReset();
  listCommands.mockResolvedValue(
    jsonResponse({
      builtIn: [{ name: '/help', description: 'Show help', namespace: 'builtin' }],
      custom: [
        {
          name: FIREWALL_COMMAND,
          description: 'Reload the firewall on a host',
          namespace: 'project',
          path: '.claude/commands/firewall-reload.md',
        },
      ],
    }),
  );
  listSkills.mockResolvedValue(jsonResponse({ success: true, data: { skills: [] } }));
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('slash command menu keyboard selection', () => {
  it('completes the command name on Tab instead of executing it', async () => {
    const { result, setInputCalls, executedCommands, textarea } = await setUp('/firewall-re');

    const tab = keyEvent('Tab');
    let handled = false;
    act(() => {
      handled = result.current.handleCommandMenuKeyDown(tab.event);
    });

    assert.equal(handled, true);
    assert.equal(tab.wasPrevented(), true);
    assert.deepEqual(setInputCalls, [`${FIREWALL_COMMAND} `]);
    assert.deepEqual(executedCommands, []);
    // Tab behaves like shell completion: the menu closes and the caret sits
    // after the trailing space so an argument can be typed immediately.
    assert.equal(result.current.showCommandMenu, false);

    textarea.value = `${FIREWALL_COMMAND} `;
    await waitFor(() => {
      assert.equal(textarea.selectionStart, `${FIREWALL_COMMAND} `.length);
    });
  });

  it('still executes the highlighted command on Enter', async () => {
    const { result, setInputCalls, executedCommands } = await setUp('/firewall-re');

    const enter = keyEvent('Enter');
    let handled = false;
    act(() => {
      handled = result.current.handleCommandMenuKeyDown(enter.event);
    });

    assert.equal(handled, true);
    assert.equal(enter.wasPrevented(), true);
    assert.deepEqual(
      executedCommands.map((command) => command.name),
      [FIREWALL_COMMAND],
    );
    assert.deepEqual(setInputCalls, []);
  });
});
