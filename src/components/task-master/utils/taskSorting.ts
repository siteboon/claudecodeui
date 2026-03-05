import type { TaskBoardSortField, TaskBoardSortOrder, TaskMasterTask } from '../types';

const STATUS_ORDER: Record<string, number> = {
  pending: 1,
  'in-progress': 2,
  review: 3,
  done: 4,
  blocked: 5,
  deferred: 6,
  cancelled: 7,
};

const PRIORITY_ORDER: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function toComparableIdParts(taskId: string | number): number[] {
  return String(taskId)
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isNaN(part) ? 0 : part));
}

function compareTaskIds(leftId: string | number, rightId: string | number): number {
  const leftParts = toComparableIdParts(leftId);
  const rightParts = toComparableIdParts(rightId);
  const maxDepth = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxDepth; index += 1) {
    const left = leftParts[index] ?? 0;
    const right = rightParts[index] ?? 0;
    if (left !== right) {
      return left - right;
    }
  }

  return 0;
}

function getSortValue(task: TaskMasterTask, field: TaskBoardSortField): number | string {
  if (field === 'title') {
    return task.title.toLowerCase();
  }

  if (field === 'status') {
    return STATUS_ORDER[task.status ?? 'pending'] ?? 999;
  }

  if (field === 'priority') {
    return PRIORITY_ORDER[task.priority ?? 'medium'] ?? 0;
  }

  if (field === 'updated') {
    const timestamp = task.updatedAt ?? task.createdAt ?? '';
    return new Date(timestamp).getTime() || 0;
  }

  return 0;
}

export function sortTasks(
  tasks: TaskMasterTask[],
  field: TaskBoardSortField,
  order: TaskBoardSortOrder,
): TaskMasterTask[] {
  const sortedTasks = [...tasks];

  sortedTasks.sort((leftTask, rightTask) => {
    const direction = order === 'asc' ? 1 : -1;

    if (field === 'id') {
      return compareTaskIds(leftTask.id, rightTask.id) * direction;
    }

    const leftValue = getSortValue(leftTask, field);
    const rightValue = getSortValue(rightTask, field);

    if (typeof leftValue === 'string' && typeof rightValue === 'string') {
      return leftValue.localeCompare(rightValue) * direction;
    }

    return (Number(leftValue) - Number(rightValue)) * direction;
  });

  return sortedTasks;
}

export function toggleSortOrder(
  currentField: TaskBoardSortField,
  currentOrder: TaskBoardSortOrder,
  nextField: TaskBoardSortField,
): TaskBoardSortOrder {
  if (currentField !== nextField) {
    return 'asc';
  }

  return currentOrder === 'asc' ? 'desc' : 'asc';
}
