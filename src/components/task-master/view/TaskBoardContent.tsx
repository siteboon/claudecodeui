import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { TaskBoardView, TaskKanbanColumn, TaskMasterTask, TaskSelection } from '../types';
import TaskCard from './TaskCard';

type TaskBoardContentProps = {
  viewMode: TaskBoardView;
  filteredTaskCount: number;
  kanbanColumns: TaskKanbanColumn[];
  filteredTasks: TaskMasterTask[];
  showParentTasks: boolean;
  onTaskClick: (task: TaskSelection) => void;
};

function KanbanColumns({
  columns,
  showParentTasks,
  onTaskClick,
}: {
  columns: TaskKanbanColumn[];
  showParentTasks: boolean;
  onTaskClick: (task: TaskSelection) => void;
}) {
  const { t } = useTranslation('tasks');

  return (
    <div
      className={cn(
        'grid gap-6',
        columns.length === 1 && 'grid-cols-1 max-w-md mx-auto',
        columns.length === 2 && 'grid-cols-1 md:grid-cols-2',
        columns.length === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        columns.length === 4 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
        columns.length === 5 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
        columns.length >= 6 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
      )}
    >
      {columns.map((column) => (
        <div key={column.id} className={cn('rounded-xl border shadow-sm transition-shadow hover:shadow-md', column.color)}>
          <div className={cn('px-4 py-3 rounded-t-xl border-b', column.headerColor)}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{column.title}</h3>
              <span className="rounded-full bg-white/60 px-2 py-1 text-xs font-medium dark:bg-black/20">
                {column.tasks.length}
              </span>
            </div>
          </div>

          <div className="max-h-[calc(100vh-300px)] min-h-[200px] space-y-3 overflow-y-auto p-3">
            {column.tasks.length === 0 ? (
              <div className="py-8 text-center text-gray-400 dark:text-gray-500">
                <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700">
                  <div className="h-3 w-3 rounded-full bg-gray-300 dark:bg-gray-600" />
                </div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('kanban.noTasksYet')}</div>
                <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {column.status === 'pending'
                    ? t('kanban.tasksWillAppear')
                    : column.status === 'in-progress'
                      ? t('kanban.moveTasksHere')
                      : column.status === 'done'
                        ? t('kanban.completedTasksHere')
                        : t('kanban.statusTasksHere')}
                </div>
              </div>
            ) : (
              column.tasks.map((task) => (
                <TaskCard
                  key={String(task.id)}
                  task={task}
                  onClick={() => onTaskClick(task)}
                  showParent={showParentTasks}
                  className="w-full shadow-sm hover:shadow-md"
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TaskBoardContent({
  viewMode,
  filteredTaskCount,
  kanbanColumns,
  filteredTasks,
  showParentTasks,
  onTaskClick,
}: TaskBoardContentProps) {
  const { t } = useTranslation('tasks');

  if (filteredTaskCount === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-gray-500 dark:text-gray-400">
          <Search className="mx-auto mb-4 h-12 w-12 opacity-50" />
          <h3 className="mb-2 text-lg font-medium">{t('noMatchingTasks.title')}</h3>
          <p className="text-sm">{t('noMatchingTasks.description')}</p>
        </div>
      </div>
    );
  }

  if (viewMode === 'kanban') {
    return <KanbanColumns columns={kanbanColumns} showParentTasks={showParentTasks} onTaskClick={onTaskClick} />;
  }

  return (
    <div className={cn('gap-4', viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'space-y-4')}>
      {filteredTasks.map((task) => (
        <TaskCard
          key={String(task.id)}
          task={task}
          onClick={() => onTaskClick(task)}
          showParent={showParentTasks}
          className={viewMode === 'grid' ? 'h-full' : ''}
        />
      ))}
    </div>
  );
}
