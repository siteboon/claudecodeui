import assert from 'node:assert/strict';

import { cleanup, render, within } from '@testing-library/react';
import { afterEach, test } from 'vitest';

import CommandMenu from '@/modules/chat/composer/CommandMenu';

afterEach(cleanup);

test('known command namespaces render before custom namespaces', () => {
  const view = render(
    <CommandMenu
      commands={[
        { name: '/custom', namespace: 'custom' },
        { name: '/skill', namespace: 'skill' },
        { name: '/builtin', namespace: 'builtin' },
      ]}
      onClose={() => undefined}
      isOpen
    />,
  );

  const options = within(view.getByRole('listbox')).getAllByRole('option');
  assert.deepEqual(
    options.map((option) => option.textContent),
    ['/builtin', '/skill', '/custom'],
  );
});
