import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskBoardSortField, TaskBoardSortOrder, TaskBoardView, TaskKanbanColumn, TaskMasterTask } from '../types';
import { buildKanbanColumns } from '../utils/taskKanban';
import { sortTasks, toggleSortOrder } from '../utils/taskSorting';

type UseTaskBoardStateOptions = {
  tasks: TaskMasterTask[];
  defaultView?: TaskBoardView;
};

function matchesSearch(task: TaskMasterTask, searchTerm: string): boolean {
  if (!searchTerm) {
    return true;
  }

  const normalizedSearch = searchTerm.toLowerCase();
  const description = typeof task.description === 'string' ? task.description : '';

  return (
    task.title.toLowerCase().includes(normalizedSearch)
    || description.toLowerCase().includes(normalizedSearch)
    || String(task.id).toLowerCase().includes(normalizedSearch)
  );
}

export function useTaskBoardState({ tasks, defaultView = 'kanban' }: UseTaskBoardStateOptions) {
  const { t } = useTranslation('tasks');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sortField, setSortField] = useState<TaskBoardSortField>('id');
  const [sortOrder, setSortOrder] = useState<TaskBoardSortOrder>('asc');
  const [viewMode, setViewMode] = useState<TaskBoardView>(defaultView);
  const [showFilters, setShowFilters] = useState(false);

  const statuses = useMemo(() => {
    return [...new Set(tasks.map((task) => task.status).filter(Boolean))] as string[];
  }, [tasks]);

  const priorities = useMemo(() => {
    return [...new Set(tasks.map((task) => task.priority).filter(Boolean))] as string[];
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      const status = task.status ?? 'pending';
      const priority = task.priority ?? 'medium';

      const matchesStatus = statusFilter === 'all' || status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || priority === priorityFilter;

      return matchesSearch(task, searchTerm) && matchesStatus && matchesPriority;
    });

    return sortTasks(filtered, sortField, sortOrder);
  }, [tasks, searchTerm, statusFilter, priorityFilter, sortField, sortOrder]);

  const kanbanColumns = useMemo<TaskKanbanColumn[]>(() => {
    return buildKanbanColumns(filteredTasks, t);
  }, [filteredTasks, t]);

  const handleSortChange = (nextSortField: TaskBoardSortField) => {
    setSortOrder((currentOrder) => toggleSortOrder(sortField, currentOrder, nextSortField));
    setSortField(nextSortField);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setPriorityFilter('all');
  };

  return {
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,
    viewMode,
    setViewMode,
    showFilters,
    setShowFilters,
    statuses,
    priorities,
    filteredTasks,
    kanbanColumns,
    handleSortChange,
    clearFilters,
  };
}
