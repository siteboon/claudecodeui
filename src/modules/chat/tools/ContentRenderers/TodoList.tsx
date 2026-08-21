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

    if (normalized.length === 0) return null;

    return (
      <div>
        {isResult && (
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            Todo List ({normalized.length} {normalized.length === 1 ? 'item' : 'items'})
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
