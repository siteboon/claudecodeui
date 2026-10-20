import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test } from 'vitest';

import type { PermissionMode } from '@/shared/types';
import ComposerPermissionMenu from '@/modules/chat/composer/ComposerPermissionMenu';

/**
 * The permission control used to be a bare icon, so nothing on screen said
 * which mode the next message would run in — plan mode included, which reads
 * as "nothing will be changed" and is the one users most need to see.
 */

const MODES = ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'] as const;

test('the composer names the mode the next message runs in', () => {
  const { getByRole } = render(
    <ComposerPermissionMenu
      permissionMode="plan"
      permissionModes={[...MODES]}
      onSelectPermissionMode={() => {}}
      providerLabel="Claude"
    />,
  );

  assert.match(getByRole('button').textContent ?? '', /Plan Mode/);
});

test('a screen reader hears the mode the button shows', () => {
  const { getByRole } = render(
    <ComposerPermissionMenu
      permissionMode="plan"
      permissionModes={[...MODES]}
      onSelectPermissionMode={() => {}}
      providerLabel="Claude"
    />,
  );

  assert.ok(getByRole('button', { name: /^Plan Mode/ }));
});

test('the default mode is named too', () => {
  const { getByRole } = render(
    <ComposerPermissionMenu
      permissionMode="default"
      permissionModes={[...MODES]}
      onSelectPermissionMode={() => {}}
      providerLabel="Claude"
    />,
  );

  assert.match(getByRole('button').textContent ?? '', /Default Mode/);
});

const renderMenu = (permissionMode: PermissionMode, permissionModes: PermissionMode[] = [...MODES]) =>
  render(
    <ComposerPermissionMenu
      permissionMode={permissionMode}
      permissionModes={permissionModes}
      onSelectPermissionMode={() => {}}
      providerLabel="Claude"
    />,
  );

test('every mode leads the accessible name, a mode with no translation by its id', () => {
  // A provider may report a mode this menu has no name for; it is named by its id.
  const unknownMode = 'dontAsk' as PermissionMode;
  const expected: Array<[PermissionMode, string]> = [
    ['default', 'Default Mode'],
    ['auto', 'Auto Mode'],
    ['acceptEdits', 'Accept Edits'],
    ['bypassPermissions', 'Bypass Permissions'],
    ['plan', 'Plan Mode'],
    [unknownMode, 'dontAsk'],
  ];

  for (const [mode, name] of expected) {
    const { getByRole, unmount } = renderMenu(mode, [...MODES, unknownMode]);
    const trigger = getByRole('button', { name: new RegExp(`^${name}: `) });
    assert.equal(trigger.textContent, name);
    unmount();
  }
});

test('only plan mode keeps its name on narrow screens', () => {
  // jsdom has no layout, so this reads the breakpoint the name is shown from.
  const nameClasses = (mode: PermissionMode) => {
    const { getByRole, unmount } = renderMenu(mode);
    const name = getByRole('button').querySelector('span');
    assert.ok(name, `${mode} has a visible name`);
    const classes = name.className.split(/\s+/);
    unmount();
    return classes;
  };

  assert.ok(!nameClasses('plan').includes('hidden'));
  for (const mode of MODES.filter((candidate) => candidate !== 'plan')) {
    const classes = nameClasses(mode);
    assert.ok(classes.includes('hidden') && classes.includes('lg:inline'), `${mode} is named from lg`);
  }
});

test('the menu ends by saying Tab in the message box switches modes', () => {
  const { getByRole } = renderMenu('default');
  fireEvent.click(getByRole('button'));

  assert.equal(getByRole('menu').lastElementChild?.textContent, 'Press Tab in the message box to switch modes');
});
