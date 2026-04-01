import { memo, useMemo } from 'react';
import { CheckCircle2, Circle, Clock, type LucideIcon } from 'lucide-react';
import { Badge } from '../../../../../shared/view/ui';

type TodoStatus = 'completed' | 'in_progress' | 'pending';
type TodoPriority = 'high' | 'medium' | 'low';

export type TodoItem = {
  id?: string;
  content: string;
  status: string;
  priority?: string;
};

type NormalizedTodoItem = {
  id?: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
};

type StatusConfig = {
  icon: LucideIcon;
  iconClassName: string;
  badgeClassName: string;
  textClassName: string;
};

// Centralized visual config keeps rendering logic compact and easier to scan.
const STATUS_CONFIG: Record<TodoStatus, StatusConfig> = {
  completed: {
    icon: CheckCircle2,
    iconClassName: 'w-3.5 h-3.5 text-green-500 dark:text-green-400',
    badgeClassName:
      'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800',
    textClassName: 'line-through text-gray-500 dark:text-gray-400',
  },
  in_progress: {
    icon: Clock,
    iconClassName: 'w-3.5 h-3.5 text-blue-500 dark:text-blue-400',
    badgeClassName:
      'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800',
    textClassName: 'text-gray-900 dark:text-gray-100',
  },
  pending: {
    icon: Circle,
    iconClassName: 'w-3.5 h-3.5 text-gray-400 dark:text-gray-500',
    badgeClassName:
      'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    textClassName: 'text-gray-900 dark:text-gray-100',
  },
};

const PRIORITY_BADGE_CLASS: Record<TodoPriority, string> = {
  high: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
  medium:
    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800',
  low: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
};

// Incoming tool payloads can vary; normalize to supported UI states.
const normalizeStatus = (status: string): TodoStatus => {
  if (status === 'completed' || status === 'in_progress') {
    return status;
  }
  return 'pending';
};

const normalizePriority = (priority?: string): TodoPriority => {
  if (priority === 'high' || priority === 'medium') {
    return priority;
  }
  return 'low';
};

const TodoRow = memo(
  ({ todo }: { todo: NormalizedTodoItem }) => {
    const statusConfig = STATUS_CONFIG[todo.status];
    const StatusIcon = statusConfig.icon;

    return (
      <div className="flex items-start gap-2 rounded border border-gray-200 bg-white p-2 transition-colors dark:border-gray-700 dark:bg-gray-800">
        <div className="mt-0.5 flex-shrink-0">
          <StatusIcon className={statusConfig.iconClassName} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-start justify-between gap-2">
            <p className={`text-xs font-medium ${statusConfig.textClassName}`}>
              {todo.content}
            </p>
            <div className="flex flex-shrink-0 gap-1">
              <Badge
                variant="outline"
                className={`px-1.5 py-px text-[10px] ${PRIORITY_BADGE_CLASS[todo.priority]}`}
              >
                {todo.priority}
              </Badge>
              <Badge
                variant="outline"
                className={`px-1.5 py-px text-[10px] ${statusConfig.badgeClassName}`}
              >
                {todo.status.replace('_', ' ')}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

const TodoList = memo(
  ({
    todos,
    isResult = false,
  }: {
    todos: TodoItem[];
    isResult?: boolean;
  }) => {
    // Memoize normalization to avoid recomputing list metadata on every render.
    const normalizedTodos = useMemo<NormalizedTodoItem[]>(
      () =>
        todos.map((todo) => ({
          id: todo.id,
          content: todo.content,
          status: normalizeStatus(todo.status),
          priority: normalizePriority(todo.priority),
        })),
      [todos]
    );

    if (normalizedTodos.length === 0) {
      return null;
    }

    return (
      <div className="space-y-1.5">
        {isResult && (
          <div className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
            Todo List ({normalizedTodos.length}{' '}
            {normalizedTodos.length === 1 ? 'item' : 'items'})
          </div>
        )}
        {normalizedTodos.map((todo, index) => (
          <TodoRow key={todo.id ?? `${todo.content}-${index}`} todo={todo} />
        ))}
      </div>
    );
  }
);

export default TodoList;
