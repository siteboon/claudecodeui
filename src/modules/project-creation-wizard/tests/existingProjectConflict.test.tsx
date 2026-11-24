import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { ProjectCreationWizard } from '@/modules/project-creation-wizard';
import type { Project } from '@/shared/types';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('ProjectCreationWizard surfaces existing project name and opens it directly on 409 conflict', async () => {
  const existingProjects: Project[] = [
    {
      projectId: 'project-1',
      displayName: 'demo-app',
      fullPath: 'F:\\Workspaces\\demo-app',
    },
  ];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith('/api/file-tree/browse-filesystem')) {
        return new Response(JSON.stringify({ path: 'F:\\Workspaces', suggestions: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === '/api/projects/create-project') {
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'PROJECT_ALREADY_EXISTS',
              message: 'Project path already exists and is active',
              details: {
                projectId: 'project-1',
                displayName: 'demo-app',
                projectPath: 'F:\\Workspaces\\demo-app',
              },
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }

      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );

  const openedProjectIds: string[] = [];
  let closedCount = 0;

  render(
    <ProjectCreationWizard
      onClose={() => {
        closedCount += 1;
      }}
      existingProjects={existingProjects}
      onOpenExistingProject={(projectId) => {
        openedProjectIds.push(projectId);
      }}
    />,
  );

  const pathInput = screen.getByPlaceholderText('/path/to/project/workspace');
  fireEvent.change(pathInput, {
    target: { value: 'F:\\Workspaces\\demo-app' },
  });

  fireEvent.click(screen.getByRole('button', { name: /Next/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Create Project/i }));
  });

  await waitFor(() => {
    assert.ok(screen.getByText('This workspace already exists as "demo-app".'));
  });

  const openButton = screen.getByRole('button', { name: /Open Project/i });
  fireEvent.click(openButton);

  assert.deepEqual(openedProjectIds, ['project-1']);
  assert.equal(closedCount, 1);
});

test('changing the workspace path clears the open-existing-project button', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === '/api/projects/create-project') {
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'PROJECT_ALREADY_EXISTS',
              message: 'Project path already exists and is active',
              details: {
                projectId: 'proj-1',
                displayName: 'demo-app',
                projectPath: '/workspace/demo-app',
              },
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }

      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );

  render(
    <ProjectCreationWizard
      onClose={() => undefined}
      onOpenExistingProject={() => undefined}
    />,
  );

  fireEvent.change(screen.getByPlaceholderText('/path/to/project/workspace'), {
    target: { value: '/workspace/demo-app' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Next/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Create Project/i }));
  });

  await waitFor(() => {
    assert.ok(screen.getByRole('button', { name: /Open Project/i }));
  });

  fireEvent.click(screen.getByRole('button', { name: /Back/i }));
  assert.equal(screen.queryByRole('button', { name: /Open Project/i }), null);
});
