import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NextTaskBanner from './NextTaskBanner';
import TaskMasterContext from '../context/TaskMasterContext';
import type { TaskMasterContextValue, TaskMasterProject, TaskMasterTask } from '../types';

function renderWithContext(contextOverrides: Partial<TaskMasterContextValue> = {}) {
  const defaultContext: TaskMasterContextValue = {
    projects: [],
    currentProject: null,
    projectTaskMaster: null,
    mcpServerStatus: null,
    tasks: [],
    nextTask: null,
    isLoading: false,
    isLoadingTasks: false,
    isLoadingMCP: false,
    error: null,
    refreshProjects: async () => {},
    setCurrentProject: () => {},
    refreshTasks: async () => {},
    refreshMCPStatus: async () => {},
    clearError: () => {},
    ...contextOverrides,
  };

  return renderToStaticMarkup(
    React.createElement(
      TaskMasterContext.Provider,
      { value: defaultContext },
      React.createElement(NextTaskBanner, { className: 'mt-5' })
    )
  );
}

test('NextTaskBanner: returns empty string when TaskMaster is not configured for current project', () => {
  const unconfiguredProject: TaskMasterProject = {
    projectId: 'proj-1',
    displayName: 'Test Project',
    fullPath: '/path/to/test-project',
    taskmaster: {
      hasTaskmaster: false,
      status: 'not-configured',
    },
  };

  const html = renderWithContext({
    currentProject: unconfiguredProject,
    projectTaskMaster: { hasTaskmaster: false, path: null, tasksPath: null, status: 'not-configured' },
    tasks: [],
    nextTask: null,
  });

  assert.equal(html, '');
  assert.equal(html.includes('TaskMaster AI is not configured'), false);
  assert.equal(html.includes('Initialize'), false);
});

test('NextTaskBanner: returns empty string when currentProject is null or loading', () => {
  const htmlNullProject = renderWithContext({
    currentProject: null,
  });
  assert.equal(htmlNullProject, '');

  const htmlLoading = renderWithContext({
    currentProject: {
      projectId: 'proj-1',
      displayName: 'Test Project',
      fullPath: '/path/to/test-project',
      taskmaster: { hasTaskmaster: true, status: 'configured' },
    },
    isLoadingTasks: true,
  });
  assert.equal(htmlLoading, '');
});

test('NextTaskBanner: renders next task when TaskMaster is configured and nextTask is available', () => {
  const configuredProject: TaskMasterProject = {
    projectId: 'proj-1',
    displayName: 'Configured Project',
    fullPath: '/path/to/configured-project',
    taskmaster: {
      hasTaskmaster: true,
      status: 'configured',
    },
  };

  const task: TaskMasterTask = {
    id: 1,
    title: 'Implement user login flow',
    status: 'pending',
    priority: 'high',
  };

  const html = renderWithContext({
    currentProject: configuredProject,
    projectTaskMaster: { hasTaskmaster: true, path: '/path', tasksPath: '/path/tasks.json', status: 'configured' },
    tasks: [task],
    nextTask: task,
  });

  assert.ok(html.includes('Implement user login flow'));
  assert.ok(html.includes('Task 1'));
  assert.ok(html.includes('Start Task'));
  assert.equal(html.includes('TaskMaster AI is not configured'), false);
});

test('NextTaskBanner: renders completion banner when all tasks are complete', () => {
  const configuredProject: TaskMasterProject = {
    projectId: 'proj-1',
    displayName: 'Configured Project',
    fullPath: '/path/to/configured-project',
    taskmaster: {
      hasTaskmaster: true,
      status: 'configured',
    },
  };

  const task: TaskMasterTask = {
    id: 1,
    title: 'Done task',
    status: 'done',
  };

  const html = renderWithContext({
    currentProject: configuredProject,
    projectTaskMaster: { hasTaskmaster: true, path: '/path', tasksPath: '/path/tasks.json', status: 'configured' },
    tasks: [task],
    nextTask: null,
  });

  assert.ok(html.includes('All tasks complete'));
  assert.equal(html.includes('TaskMaster AI is not configured'), false);
});
