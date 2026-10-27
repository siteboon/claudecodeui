import { expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';

import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';

it('renders an unknown provider tool named constructor with its name and input summary', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    React.createElement(ToolRenderer, {
      toolName: 'constructor',
      // Provider transcript normalization serializes tool arguments.
      toolInput: JSON.stringify({ command: 'npm test' }),
      mode: 'input',
    }),
  );

  expect(container.textContent).toContain('npm test');
  expect(container.textContent).toContain('constructor');
});

it('lets the user allow or deny a permission request for an unknown tool named constructor', () => {
  const handlePermissionDecision = vi.fn();
  render(
    <PermissionRequestsBanner
      pendingPermissionRequests={[{ requestId: 'permission-1', toolName: 'constructor' }]}
      handlePermissionDecision={handlePermissionDecision}
      handleGrantToolPermission={() => ({ success: true })}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
  expect(handlePermissionDecision).toHaveBeenLastCalledWith('permission-1', { allow: true });

  fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
  expect(handlePermissionDecision).toHaveBeenLastCalledWith(
    'permission-1',
    expect.objectContaining({ allow: false }),
  );
});
