import { memo, useMemo } from 'react';

import { Queue, QueueItem, QueueItemContent, QueueItemIndicator } from '@/modules/chat/tools/Queue';
import type { QueueItemStatus, TodoItem } from '@/shared/types';


const normalizeStatus = (status: string): QueueItemStatus => {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'pending';
};

/**
 * Rendered by chat's TodoListContent to draw the todo items as a status queue.
 *
 * This is the one checklist view in the app: Claude's TodoWrite and task
 * tracker and Codex's plan updates are all normalized onto the todo shape
 * before they get here, so a checklist looks identical whichever agent built it.
 */
const TodoList = memo(
  ({
    todos,
    isResult = false,
  }: {
    todos: TodoItem[];
    isResult?: boolean;
  }) => {
    const normalized = useMemo(
      () => todos.map((todo) => ({ ...todo, queueStatus: normalizeStatus(todo.status) })),
      [todos],
    );

    const completed = useMemo(
      () => normalized.filter((todo) => todo.queueStatus === 'completed').length,
      [normalized],
    );

    if (normalized.length === 0) return null;

    return (
      <div>
        {isResult && (
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            Todo List ({normalized.length} {normalized.length === 1 ? 'item' : 'items'})
          </div>
        )}
        {/* The count lives in the row header; this only draws the shape of it. */}
        {normalized.length > 1 && (
          <div className="mb-1.5 h-0.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-green-500 transition-all dark:bg-green-400"
              style={{ width: `${(completed / normalized.length) * 100}%` }}
            />
          </div>
        )}
        <Queue>
          {normalized.map((todo, index) => (
            <QueueItem key={todo.id ?? `${todo.content}-${index}`} status={todo.queueStatus}>
              <QueueItemIndicator />
              <QueueItemContent>{todo.content}</QueueItemContent>
            </QueueItem>
          ))}
        </Queue>
      </div>
    );
  },
);

TodoList.displayName = 'TodoList';

export default TodoList;
