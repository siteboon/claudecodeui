import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import type { KeyboardEvent, RefObject } from 'react';

import type { Project, SlashCommand } from '@/shared/types';

/**
 * Regression guard for #1560: the slash menu commits the typed query only after
 * a 150 ms debounce, but Enter, Tab and the arrow keys read the list for the
 * query already committed. A key pressed inside that window therefore acted on
 * the previous query's list: for a fresh command that is the whole list sorted
 * by usage, so Enter ran the most-used command instead of the typed one. The
 * keys must act on the text actually in the input.
 *
 * Unless a test waits on purpose, every keystroke and key press below happens
 * in one synchronous run, so the 150 ms debounce timer cannot fire in between:
 * that is the window the bug lived in.
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

const projectCommand = (name: string) => ({
  name,
  description: `Project command ${name}`,
  namespace: 'project',
  path: `.claude/commands${name}.md`,
});

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

const setUp = async (
  customCommandNames: string[],
  usageHistory: Record<string, number>,
  skillCommandNames: string[] = [],
) => {
  localStorage.setItem(`command_history_${project.projectId}`, JSON.stringify(usageHistory));
  listCommands.mockResolvedValue(
    jsonResponse({
      builtIn: [{ name: '/help', description: 'Show help', namespace: 'builtin' }],
      custom: customCommandNames.map(projectCommand),
    }),
  );
  listSkills.mockResolvedValue(
    jsonResponse({
      success: true,
      data: {
        skills: skillCommandNames.map((command) => ({
          name: command.slice(1),
          command,
          scope: 'project',
          description: `Skill ${command}`,
        })),
      },
    }),
  );

  const setInputCalls: string[] = [];
  const executedCommands: SlashCommand[] = [];
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  const textareaRef = { current: textarea } as RefObject<HTMLTextAreaElement>;
  // Every render the hook goes through. A key pressed right after another one
  // can reach the handler of the first render that follows it, before React
  // renders again, so tests can press keys through an earlier render.
  const renders: Array<{
    listed: string[];
    handleCommandMenuKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  }> = [];

  const { result, rerender } = renderHook(
    ({ input }: { input: string }) => {
      const hook = useSlashCommands({
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
      });
      renders.push({
        listed: hook.filteredCommands.map((command) => command.name),
        handleCommandMenuKeyDown: hook.handleCommandMenuKeyDown,
      });
      return hook;
    },
    { initialProps: { input: '' } },
  );

  await waitFor(() => assert.equal(
    result.current.slashCommandsCount,
    customCommandNames.length + skillCommandNames.length + 1,
  ));

  // Mirrors the composer: one input change per typed character, each telling
  // the hook the new text and where the caret is.
  const typeQuickly = (text: string) => {
    for (let length = 1; length <= text.length; length += 1) {
      const typed = text.slice(0, length);
      textarea.value = typed;
      textarea.setSelectionRange(typed.length, typed.length);
      rerender({ input: typed });
      act(() => {
        result.current.handleCommandInputChange(typed, typed.length);
      });
    }
  };

  const press = (key: string) => {
    const pressed = keyEvent(key);
    let handled = false;
    act(() => {
      handled = result.current.handleCommandMenuKeyDown(pressed.event);
    });
    return { handled, prevented: pressed.wasPrevented() };
  };

  const listedNames = () => result.current.filteredCommands.map((command) => command.name);

  return { result, renders, setInputCalls, executedCommands, typeQuickly, press, listedNames };
};

beforeEach(() => {
  localStorage.clear();
  listCommands.mockReset();
  listSkills.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('slash command keys pressed inside the filter debounce', () => {
  it('runs the typed command on Enter, not the most-used one', async () => {
    const { result, executedCommands, typeQuickly, press, listedNames } = await setUp(
      ['/foo', '/bar'],
      { '/foo': 5 },
    );

    typeQuickly('/bar');
    // The rendered list is still debounced: it has not caught up with "/bar".
    assert.equal(result.current.commandQuery, '');
    assert.equal(listedNames()[0], '/foo');

    const enter = press('Enter');

    assert.equal(enter.handled, true);
    assert.equal(enter.prevented, true);
    assert.deepEqual(executedCommands.map((command) => command.name), ['/bar']);
    // Running the command closes the menu, and the cancelled debounce timer
    // must not reopen it with the old query afterwards.
    assert.equal(result.current.showCommandMenu, false);
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    assert.equal(result.current.showCommandMenu, false);
    assert.equal(result.current.commandQuery, '');
  });

  it('completes the typed command on Tab, not the most-used one', async () => {
    const { setInputCalls, executedCommands, typeQuickly, press } = await setUp(
      ['/foo', '/bar'],
      { '/foo': 5 },
    );

    typeQuickly('/bar');
    const tab = press('Tab');

    assert.equal(tab.handled, true);
    assert.deepEqual(setInputCalls, ['/bar ']);
    assert.deepEqual(executedCommands, []);
  });

  it('runs the typed command when the slash follows other text', async () => {
    const { executedCommands, typeQuickly, press } = await setUp(['/foo', '/bar'], { '/foo': 5 });

    typeQuickly('see /bar');
    press('Enter');

    assert.deepEqual(executedCommands.map((command) => command.name), ['/bar']);
  });

  it('inserts a typed namespaced skill on Enter instead of running the most-used command', async () => {
    const { setInputCalls, executedCommands, typeQuickly, press } = await setUp(
      ['/foo'],
      { '/foo': 5 },
      ['/plugin:review'],
    );

    typeQuickly('/plugin:re');
    press('Enter');

    assert.deepEqual(executedCommands, []);
    assert.deepEqual(setInputCalls, ['/plugin:review ']);
  });

  it('moves the highlight through the list for the typed text', async () => {
    const { result, executedCommands, typeQuickly, press, listedNames } = await setUp(
      ['/foo', '/bar', '/baz', '/bazooka'],
      { '/foo': 5 },
    );

    typeQuickly('/ba');
    // ArrowUp wraps to the last entry. Against the previous (full) list that
    // index is 4, which points past the end of the "/ba" list the menu shows
    // a moment later, so pin both the list and the index.
    press('ArrowUp');
    assert.deepEqual(listedNames(), ['/bar', '/baz', '/bazooka']);
    assert.equal(result.current.selectedCommandIndex, 2);

    press('ArrowUp');
    assert.equal(result.current.selectedCommandIndex, 1);
    press('Enter');
    assert.deepEqual(executedCommands.map((command) => command.name), ['/baz']);
  });

  it('drops a hover highlight made on the previous list', async () => {
    const { result, executedCommands, typeQuickly, press } = await setUp(
      ['/foo', '/bar', '/baz', '/bazooka'],
      { '/foo': 5 },
    );

    typeQuickly('/ba');
    // The pointer rests on the second row of the list still on screen
    // (/help); in the list for "/ba" index 1 is /baz, which was never shown.
    act(() => {
      result.current.handleCommandSelect(result.current.filteredCommands[1], 1, true);
    });
    press('ArrowDown');
    assert.equal(result.current.selectedCommandIndex, 0);

    typeQuickly('/ba');
    act(() => {
      result.current.handleCommandSelect(result.current.filteredCommands[1], 1, true);
    });
    press('Enter');
    assert.deepEqual(executedCommands.map((command) => command.name), ['/bar']);
  });

  it('acts on the typed list for a key that follows the flush before React renders again', async () => {
    const { renders, executedCommands, typeQuickly, press } = await setUp(
      ['/foo', '/bar', '/baz'],
      { '/foo': 5 },
    );

    typeQuickly('/ba');
    const rendersBeforeArrow = renders.length;
    press('ArrowDown');

    // Keys pressed back to back: Enter reaches the handler of the first render
    // after the ArrowDown, so that render must already hold the typed list,
    // not the full one for the query committed before.
    const firstRenderAfterArrow = renders[rendersBeforeArrow];
    assert.deepEqual(firstRenderAfterArrow.listed, ['/bar', '/baz']);
    act(() => {
      firstRenderAfterArrow.handleCommandMenuKeyDown(keyEvent('Enter').event);
    });
    assert.deepEqual(executedCommands.map((command) => command.name), ['/bar']);
  });

  it('runs the typed command for an Enter right after the debounce timer fires', async () => {
    const { result, executedCommands, typeQuickly } = await setUp(['/foo', '/bar'], { '/foo': 5 });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    typeQuickly('/bar');
    // Inside act() an ordinary update renders only once act() returns, so this
    // Enter is handled straight after the timer commits "bar", before a render
    // React would schedule for it: in the browser that render runs in a later
    // task, and a key in between reached the render that listed everything.
    act(() => {
      vi.advanceTimersByTime(150);
      result.current.handleCommandMenuKeyDown(keyEvent('Enter').event);
    });

    assert.deepEqual(executedCommands.map((command) => command.name), ['/bar']);
  });

  it('drops a hover highlight made on the previous list when the timer commits the query', async () => {
    const { result, executedCommands, typeQuickly, listedNames } = await setUp(
      ['/foo', '/bar', '/baz', '/bazooka'],
      { '/foo': 5 },
    );

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    typeQuickly('/ba');
    // The pointer rests on the last row of the list still on screen
    // (/bazooka, index 4), which is past the end of the list for "/ba".
    act(() => {
      result.current.handleCommandSelect(result.current.filteredCommands[4], 4, true);
    });
    let atKey = { listed: [] as string[], highlightedIndex: 0 };
    // As in the Enter test above, the key lands straight after the timer.
    act(() => {
      vi.advanceTimersByTime(150);
      atKey = { listed: listedNames(), highlightedIndex: result.current.selectedCommandIndex };
      result.current.handleCommandMenuKeyDown(keyEvent('Enter').event);
    });

    // Same as a key pressed before the timer: the list for "/ba" with nothing
    // highlighted, so Enter runs its top row instead of nothing.
    assert.deepEqual(atKey.listed, ['/bar', '/baz', '/bazooka']);
    assert.equal(atKey.highlightedIndex, -1);
    assert.deepEqual(executedCommands.map((command) => command.name), ['/bar']);
  });

  it('keeps a hover highlight made after the timer commits the query already shown', async () => {
    const { result, executedCommands, typeQuickly, press } = await setUp(
      ['/foo', '/bar', '/baz', '/bazooka'],
      { '/foo': 5 },
    );

    typeQuickly('/ba');
    await waitFor(() => assert.equal(result.current.commandQuery, 'ba'));
    // An "r" typed and deleted inside the window: the timer then commits "ba"
    // again, which changes nothing, and the pointer then picks a row of it.
    typeQuickly('/bar');
    typeQuickly('/ba');
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    act(() => {
      result.current.handleCommandSelect(result.current.filteredCommands[2], 2, true);
    });
    press('Enter');

    assert.deepEqual(executedCommands.map((command) => command.name), ['/bazooka']);
  });

  it('lists every command again at the next slash after a pick', async () => {
    const { executedCommands, typeQuickly, press, listedNames } = await setUp(
      ['/foo', '/bar'],
      { '/foo': 5 },
    );

    typeQuickly('/bar');
    press('Enter');
    assert.deepEqual(executedCommands.map((command) => command.name), ['/bar']);

    // The pick commits "bar" and resets the query in the same event, so the
    // query never visibly changes; the next "/" must still list everything.
    typeQuickly('/');
    assert.deepEqual(listedNames(), ['/foo', '/help', '/bar']);
  });

  it('keeps the full list the toggle shows when a typed query is still waiting', async () => {
    const { result, executedCommands, typeQuickly, press, listedNames } = await setUp(
      ['/foo', '/bar'],
      { '/foo': 5 },
    );

    typeQuickly('/bar');
    // The menu button closes and reopens the menu inside the window.
    act(() => {
      result.current.handleToggleCommandMenu();
    });
    act(() => {
      result.current.handleToggleCommandMenu();
    });
    assert.equal(result.current.showCommandMenu, true);

    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    assert.equal(result.current.commandQuery, '');
    assert.deepEqual(listedNames(), ['/foo', '/help', '/bar']);
    // Enter acts on the row shown on top.
    press('Enter');
    assert.deepEqual(executedCommands.map((command) => command.name), ['/foo']);
  });

  it('keeps a hover highlight made once the list has caught up', async () => {
    const { result, executedCommands, typeQuickly, press, listedNames } = await setUp(
      ['/foo', '/bar', '/baz', '/bazooka'],
      { '/foo': 5 },
    );

    typeQuickly('/ba');
    await waitFor(() => assert.deepEqual(listedNames(), ['/bar', '/baz', '/bazooka']));
    act(() => {
      result.current.handleCommandSelect(result.current.filteredCommands[2], 2, true);
    });
    press('Enter');

    assert.deepEqual(executedCommands.map((command) => command.name), ['/bazooka']);
  });

  it('lets Enter fall through to a normal send when nothing matches the typed text', async () => {
    const { result, executedCommands, setInputCalls, typeQuickly, press } = await setUp(
      ['/foo', '/bar'],
      { '/foo': 5 },
    );

    typeQuickly('/nope');
    const enter = press('Enter');

    // Same as once the debounce has settled: the menu has nothing to pick, so
    // the composer's own Enter handling (submit) takes the key.
    assert.equal(enter.handled, false);
    assert.equal(enter.prevented, false);
    assert.deepEqual(executedCommands, []);
    assert.deepEqual(setInputCalls, []);
    assert.equal(result.current.filteredCommands.length, 0);
  });

  it('keeps the debounce for keys that do not pick an entry', async () => {
    const { result, typeQuickly, press } = await setUp(['/foo', '/bar'], { '/foo': 5 });

    typeQuickly('/ba');
    const character = press('r');

    assert.equal(character.handled, false);
    // Typing must not re-filter on every keystroke: the pending query is
    // still waiting for its timer.
    assert.equal(result.current.commandQuery, '');

    await waitFor(() => assert.equal(result.current.commandQuery, 'ba'));
  });

  it('still closes the menu on Escape inside the window', async () => {
    const { result, executedCommands, typeQuickly, press } = await setUp(['/foo', '/bar'], { '/foo': 5 });

    typeQuickly('/bar');
    const escape = press('Escape');

    assert.equal(escape.handled, true);
    assert.equal(result.current.showCommandMenu, false);
    assert.deepEqual(executedCommands, []);
    // The timer was cancelled with the menu: it must not reopen or refilter.
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    assert.equal(result.current.commandQuery, '');
    assert.equal(result.current.showCommandMenu, false);
  });
});

describe('slash command exact-name match', () => {
  it('lists a fully typed command first, ahead of a more-used longer match', async () => {
    const { result, executedCommands, typeQuickly, press, listedNames } = await setUp(
      ['/bar', '/bar-baz'],
      { '/bar-baz': 5 },
    );

    typeQuickly('/bar');
    await waitFor(() => assert.equal(result.current.commandQuery, 'bar'));

    // Enter acts on the first entry, and sending "/bar" runs /bar, so a fully
    // typed name must be that first entry.
    assert.deepEqual(listedNames(), ['/bar', '/bar-baz']);
    press('Enter');
    assert.deepEqual(executedCommands.map((command) => command.name), ['/bar']);
  });

  it('ignores case for the fully typed name, like the prefix match', async () => {
    const { result, typeQuickly, listedNames } = await setUp(['/Review', '/review-all'], { '/review-all': 5 });

    typeQuickly('/review');
    await waitFor(() => assert.equal(result.current.commandQuery, 'review'));

    assert.deepEqual(listedNames(), ['/Review', '/review-all']);
  });

  it('lists a fully typed namespaced name first', async () => {
    const { result, typeQuickly, listedNames } = await setUp(
      [],
      { '/plugin:review-all': 5 },
      ['/plugin:review', '/plugin:review-all'],
    );

    typeQuickly('/plugin:review');
    await waitFor(() => assert.equal(result.current.commandQuery, 'plugin:review'));

    assert.deepEqual(listedNames(), ['/plugin:review', '/plugin:review-all']);
  });

  it('keeps the usage order while the name is only a prefix', async () => {
    const { result, typeQuickly, listedNames } = await setUp(['/bar', '/bar-baz'], { '/bar-baz': 5 });

    typeQuickly('/ba');
    await waitFor(() => assert.equal(result.current.commandQuery, 'ba'));

    assert.deepEqual(listedNames(), ['/bar-baz', '/bar']);
  });
});
