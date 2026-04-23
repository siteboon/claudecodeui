import type { TFunction } from 'i18next';

import type { TaskKanbanColumn, TaskMasterTask } from '../types';

const KANBAN_COLUMN_CONFIG = [
  {
    id: 'pending',
    titleKey: 'kanban.pending',
    status: 'pending',
    color: 'ds-tile-inset',
    headerColor: 'bg-muted text-foreground',
  },
  {
    id: 'in-progress',
    titleKey: 'kanban.inProgress',
    status: 'in-progress',
    color: 'ds-tile-inset border-sky/30',
    headerColor: 'bg-sky/15 text-sky',
  },
  {
    id: 'done',
    titleKey: 'kanban.done',
    status: 'done',
    color: 'ds-tile-inset border-mint/30',
    headerColor: 'bg-mint/15 text-mint',
  },
  {
    id: 'blocked',
    titleKey: 'kanban.blocked',
    status: 'blocked',
    color: 'ds-tile-inset border-blush/30',
    headerColor: 'bg-blush/15 text-blush',
  },
  {
    id: 'deferred',
    titleKey: 'kanban.deferred',
    status: 'deferred',
    color: 'ds-tile-inset border-butter/30',
    headerColor: 'bg-butter/15 text-butter',
  },
  {
    id: 'cancelled',
    titleKey: 'kanban.cancelled',
    status: 'cancelled',
    color: 'ds-tile-inset',
    headerColor: 'bg-muted text-muted-foreground',
  },
] as const;

const CORE_WORKFLOW_STATUSES = new Set(['pending', 'in-progress', 'done']);

export function buildKanbanColumns(tasks: TaskMasterTask[], t: TFunction<'tasks'>): TaskKanbanColumn[] {
  const tasksByStatus = tasks.reduce<Record<string, TaskMasterTask[]>>((accumulator, task) => {
    const status = task.status ?? 'pending';
    if (!accumulator[status]) {
      accumulator[status] = [];
    }
    accumulator[status].push(task);
    return accumulator;
  }, {});

  return KANBAN_COLUMN_CONFIG.filter((column) => {
    const hasTasks = (tasksByStatus[column.status] ?? []).length > 0;
    return hasTasks || CORE_WORKFLOW_STATUSES.has(column.status);
  }).map((column) => ({
    id: column.id,
    title: t(column.titleKey),
    status: column.status,
    color: column.color,
    headerColor: column.headerColor,
    tasks: tasksByStatus[column.status] ?? [],
  }));
}
