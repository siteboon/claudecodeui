import { memo, useMemo } from 'react';
import { Queue, QueueItem, QueueItemIndicator, QueueItemContent } from '../../../../../shared/view/ui';
import type { QueueItemStatus } from '../../../../../shared/view/ui';

export type TodoItem = {
  id?: string;
  content: string;
  status: string;
  priority?: string;
  activeForm?: string;
};

const normalizeStatus = (status: string): QueueItemStatus => {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'pending';
};

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
