import type { TFunction } from 'i18next';
import type { TaskKanbanColumn, TaskMasterTask } from '../types';

const KANBAN_COLUMN_CONFIG = [
  {
    id: 'pending',
    titleKey: 'kanban.pending',
    status: 'pending',
    color: 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700',
    headerColor: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200',
  },
  {
    id: 'in-progress',
    titleKey: 'kanban.inProgress',
    status: 'in-progress',
    color: 'bg-blue-50 dark:bg-blue-900/50 border-blue-200 dark:border-blue-700',
    headerColor: 'bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200',
  },
  {
    id: 'done',
    titleKey: 'kanban.done',
    status: 'done',
    color: 'bg-emerald-50 dark:bg-emerald-900/50 border-emerald-200 dark:border-emerald-700',
    headerColor: 'bg-emerald-100 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200',
  },
  {
    id: 'blocked',
    titleKey: 'kanban.blocked',
    status: 'blocked',
    color: 'bg-red-50 dark:bg-red-900/50 border-red-200 dark:border-red-700',
    headerColor: 'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200',
  },
  {
    id: 'deferred',
    titleKey: 'kanban.deferred',
    status: 'deferred',
    color: 'bg-amber-50 dark:bg-amber-900/50 border-amber-200 dark:border-amber-700',
    headerColor: 'bg-amber-100 dark:bg-amber-800 text-amber-800 dark:text-amber-200',
  },
  {
    id: 'cancelled',
    titleKey: 'kanban.cancelled',
    status: 'cancelled',
    color: 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700',
    headerColor: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200',
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
