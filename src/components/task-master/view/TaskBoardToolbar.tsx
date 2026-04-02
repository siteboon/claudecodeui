import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Columns,
  FileText,
  Filter,
  Grid,
  HelpCircle,
  List,
  Plus,
  Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { PrdFile, TaskBoardSortField, TaskBoardSortOrder, TaskBoardView } from '../types';
import TaskFiltersPanel from './shared/TaskFiltersPanel';
import TaskQuickSortBar from './shared/TaskQuickSortBar';

type TaskBoardToolbarProps = {
  hasProject: boolean;
  hasTaskMasterConfigured: boolean;
  totalTaskCount: number;
  filteredTaskCount: number;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  viewMode: TaskBoardView;
  onViewModeChange: (viewMode: TaskBoardView) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (priority: string) => void;
  sortField: TaskBoardSortField;
  sortOrder: TaskBoardSortOrder;
  onSortChange: (field: TaskBoardSortField) => void;
  onSortConfigChange: (field: TaskBoardSortField, order: TaskBoardSortOrder) => void;
  statuses: string[];
  priorities: string[];
  onClearFilters: () => void;
  existingPrds: PrdFile[];
  onCreatePrd: () => void;
  onOpenPrd: (prd: PrdFile) => void;
  onOpenHelp: () => void;
  onOpenCreateTask: () => void;
};

export default function TaskBoardToolbar({
  hasProject,
  hasTaskMasterConfigured,
  totalTaskCount,
  filteredTaskCount,
  searchTerm,
  onSearchTermChange,
  viewMode,
  onViewModeChange,
  showFilters,
  onToggleFilters,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  sortField,
  sortOrder,
  onSortChange,
  onSortConfigChange,
  statuses,
  priorities,
  onClearFilters,
  existingPrds,
  onCreatePrd,
  onOpenPrd,
  onOpenHelp,
  onOpenCreateTask,
}: TaskBoardToolbarProps) {
  const { t } = useTranslation('tasks');
  const [isPrdDropdownOpen, setIsPrdDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsPrdDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder={t('search.placeholder')}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            <button
              onClick={() => onViewModeChange('kanban')}
              className={cn(
                'p-2 rounded-md',
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              )}
              title={t('views.kanban')}
            >
              <Columns className="h-4 w-4" />
            </button>

            <button
              onClick={() => onViewModeChange('list')}
              className={cn(
                'p-2 rounded-md',
                viewMode === 'list'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              )}
              title={t('views.list')}
            >
              <List className="h-4 w-4" />
            </button>

            <button
              onClick={() => onViewModeChange('grid')}
              className={cn(
                'p-2 rounded-md',
                viewMode === 'grid'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
              )}
              title={t('views.grid')}
            >
              <Grid className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={onToggleFilters}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
              showFilters
                ? 'bg-blue-50 dark:bg-blue-900 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
            )}
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">{t('filters.button')}</span>
            <ChevronDown className={cn('w-4 h-4 transition-transform', showFilters && 'rotate-180')} />
          </button>

          {hasProject && (
            <>
              <button
                onClick={onOpenHelp}
                className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-100 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-blue-400"
                title={t('buttons.help')}
              >
                <HelpCircle className="h-4 w-4" />
              </button>

              <div ref={dropdownRef} className="relative">
                {existingPrds.length > 0 ? (
                  <>
                    <button
                      onClick={() => setIsPrdDropdownOpen((current) => !current)}
                      className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 font-medium text-white hover:bg-purple-700"
                      title={t('buttons.prdsAvailable', { count: existingPrds.length })}
                    >
                      <FileText className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('buttons.prds')}</span>
                      <span className="min-w-5 rounded-full bg-purple-500 px-1.5 py-0.5 text-center text-xs">
                        {existingPrds.length}
                      </span>
                      <ChevronDown className={cn('w-3 h-3 transition-transform hidden sm:block', isPrdDropdownOpen && 'rotate-180')} />
                    </button>

                    {isPrdDropdownOpen && (
                      <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                        <div className="p-2">
                          <button
                            onClick={() => {
                              onCreatePrd();
                              setIsPrdDropdownOpen(false);
                            }}
                            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-900/30"
                          >
                            <Plus className="h-4 w-4" />
                            {t('buttons.createNewPRD')}
                          </button>

                          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                          {existingPrds.map((prd) => (
                            <button
                              key={prd.name}
                              onClick={() => {
                                onOpenPrd(prd);
                                setIsPrdDropdownOpen(false);
                              }}
                              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                            >
                              <FileText className="h-4 w-4" />
                              <span className="truncate">{prd.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <button
                    onClick={onCreatePrd}
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 font-medium text-white hover:bg-purple-700"
                    title={t('buttons.addPRD')}
                  >
                    <FileText className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('buttons.addPRD')}</span>
                  </button>
                )}
              </div>

              {(hasTaskMasterConfigured || totalTaskCount > 0) && (
                <button
                  onClick={onOpenCreateTask}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700"
                  title={t('buttons.addTask')}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('buttons.addTask')}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <TaskFiltersPanel
        showFilters={showFilters}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={onPriorityFilterChange}
        sortField={sortField}
        sortOrder={sortOrder}
        onSortConfigChange={onSortConfigChange}
        statuses={statuses}
        priorities={priorities}
        filteredTaskCount={filteredTaskCount}
        totalTaskCount={totalTaskCount}
        onClearFilters={onClearFilters}
      />

      <TaskQuickSortBar sortField={sortField} sortOrder={sortOrder} onSortChange={onSortChange} />
    </>
  );
}
