import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { describe, it } from 'vitest';

import '@/modules/i18n';
import CommandMenu from '@/modules/chat/composer/CommandMenu';

/**
 * Regression guard for #1560: with nothing highlighted, Enter and Tab act on
 * the first command of the list the slash hook hands the menu (ranked by usage,
 * a fully typed name first), but the menu drew its groups in a fixed order:
 * built-ins before skills before project and user commands. So when that first
 * command sat in a later group, Enter ran a row that was not the top one. The
 * group holding it must lead.
 */

const builtin = (name: string) => ({ name, namespace: 'builtin', metadata: { type: 'builtin' } });
const project = (name: string) => ({ name, namespace: 'project', path: `.claude/commands${name}.md` });
const user = (name: string) => ({ name, namespace: 'user', path: `~/.claude/commands${name}.md` });

type MenuCommand = ReturnType<typeof builtin> | ReturnType<typeof project>;

const renderedNames = (commands: MenuCommand[], frequentCommands: MenuCommand[] = []) => {
  render(
    <CommandMenu
      isOpen
      commands={commands}
      frequentCommands={frequentCommands}
      onClose={() => undefined}
    />,
  );
  // The menu renders into a portal on document.body.
  return Array.from(document.body.querySelectorAll('[role="option"] span[title]')).map((element) =>
    element.getAttribute('title'),
  );
};

describe('slash command menu group order', () => {
  it('puts the group of the first command on top, so the top row is what Enter runs', () => {
    // "/stat" typed: the hook lists the exact project command ahead of a
    // more-used built-in that also starts with it.
    assert.deepEqual(renderedNames([project('/stat'), builtin('/status')]), ['/stat', '/status']);
  });

  it('highlights the top row for the first command', () => {
    render(
      <CommandMenu
        isOpen
        commands={[project('/stat'), builtin('/status')]}
        selectedIndex={0}
        onClose={() => undefined}
      />,
    );

    const rows = Array.from(document.body.querySelectorAll('[role="option"]'));
    assert.deepEqual(
      rows.map((row) => row.getAttribute('aria-selected')),
      ['true', 'false'],
    );
  });

  it('keeps the group order while the highlight moves into a later group', () => {
    render(
      <CommandMenu
        isOpen
        commands={[project('/stat'), builtin('/status')]}
        selectedIndex={1}
        onClose={() => undefined}
      />,
    );

    // The order follows the first command, not the highlighted one, so the
    // groups do not swap places on every arrow key.
    const rows = Array.from(document.body.querySelectorAll('[role="option"]'));
    assert.deepEqual(
      rows.map((row) => row.querySelector('span[title]')?.getAttribute('title')),
      ['/stat', '/status'],
    );
    assert.deepEqual(
      rows.map((row) => row.getAttribute('aria-selected')),
      ['false', 'true'],
    );
  });

  it('keeps the remaining groups in their usual order', () => {
    assert.deepEqual(
      renderedNames([user('/stat-user'), builtin('/status'), project('/stat-project')]),
      ['/stat-user', '/status', '/stat-project'],
    );
  });

  it('keeps the usual order when the first command is a built-in', () => {
    assert.deepEqual(
      renderedNames([builtin('/help'), project('/deploy'), builtin('/status')]),
      ['/help', '/status', '/deploy'],
    );
  });

  it('still leads with the frequently used group when it is shown', () => {
    assert.deepEqual(
      renderedNames(
        [project('/deploy'), builtin('/help'), project('/other')],
        [project('/deploy')],
      ),
      ['/deploy', '/help', '/other'],
    );
  });
});
