import React from 'react';
import TodoList from '../../../../TodoList';

interface TodoListContentProps {
  todos: Array<{
    id?: string;
    content: string;
    status: string;
    priority?: string;
  }>;
  isResult?: boolean;
}

/**
 * Renders a todo list
 * Used by: TodoWrite, TodoRead
 */
export const TodoListContent: React.FC<TodoListContentProps> = ({
  todos,
  isResult = false
}) => {
  return <TodoList todos={todos} isResult={isResult} />;
};
