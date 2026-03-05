import { useTranslation } from 'react-i18next';
import type { TaskBoardSortField, TaskBoardSortOrder } from '../../types';

type TaskFiltersPanelProps = {
  showFilters: boolean;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (priority: string) => void;
  sortField: TaskBoardSortField;
  sortOrder: TaskBoardSortOrder;
  onSortConfigChange: (field: TaskBoardSortField, order: TaskBoardSortOrder) => void;
  statuses: string[];
  priorities: string[];
  filteredTaskCount: number;
  totalTaskCount: number;
  onClearFilters: () => void;
};

export default function TaskFiltersPanel({
  showFilters,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  sortField,
  sortOrder,
  onSortConfigChange,
  statuses,
  priorities,
  filteredTaskCount,
  totalTaskCount,
  onClearFilters,
}: TaskFiltersPanelProps) {
  const { t } = useTranslation('tasks');

  if (!showFilters) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('filters.status')}</label>
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="all">{t('filters.allStatuses')}</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`, status)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('filters.priority')}</label>
          <select
            value={priorityFilter}
            onChange={(event) => onPriorityFilterChange(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="all">{t('filters.allPriorities')}</option>
            {priorities.map((priority) => (
              <option key={priority} value={priority}>
                {t(`priorities.${priority}`, priority)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('filters.sortBy')}</label>
          <select
            value={`${sortField}-${sortOrder}`}
            onChange={(event) => {
              const [field, order] = event.target.value.split('-') as [TaskBoardSortField, TaskBoardSortOrder];
              onSortConfigChange(field, order);
            }}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="id-asc">{t('sort.idAsc')}</option>
            <option value="id-desc">{t('sort.idDesc')}</option>
            <option value="title-asc">{t('sort.titleAsc')}</option>
            <option value="title-desc">{t('sort.titleDesc')}</option>
            <option value="status-asc">{t('sort.statusAsc')}</option>
            <option value="status-desc">{t('sort.statusDesc')}</option>
            <option value="priority-asc">{t('sort.priorityAsc')}</option>
            <option value="priority-desc">{t('sort.priorityDesc')}</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {t('filters.showing', { filtered: filteredTaskCount, total: totalTaskCount })}
        </div>
        <button onClick={onClearFilters} className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
          {t('filters.clearFilters')}
        </button>
      </div>
    </div>
  );
}
