import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test } from 'vitest';

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
