import { memo, useMemo } from 'react';

import TodoList from '@/modules/chat/tools/ContentRenderers/TodoList';
import type { TodoItem } from '@/shared/types';

const isTodoItem = (value: unknown): value is TodoItem => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const todo = value as Record<string, unknown>;
  return typeof todo.content === 'string' && typeof todo.status === 'string';
};

/**
 * Renders a todo list
 * Used by: TodoWrite, TodoRead
 *
 * Rendered by chat's ToolRenderer as the content of a todo tool result.
 */
export const TodoListContent = memo(
  ({
    todos,
    isResult = false,
  }: {
    todos: unknown;
    isResult?: boolean;
  }) => {
    const safeTodos = useMemo<TodoItem[]>(() => {
      if (!Array.isArray(todos)) {
        return [];
      }

      // Tool payloads are runtime data; render only validated todo objects.
      return todos.filter(isTodoItem);
    }, [todos]);

    if (safeTodos.length === 0) {
      return null;
    }

    return <TodoList todos={safeTodos} isResult={isResult} />;
  }
);
