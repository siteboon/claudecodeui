import { useCallback, useEffect, useRef, useState } from 'react';
import TaskList from '../../../TaskList';
import TaskDetail from '../../../TaskDetail';
import PRDEditor from '../../../PRDEditor';
import { useTaskMaster } from '../../../../contexts/TaskMasterContext';
import { api } from '../../../../utils/api';
import type { Project } from '../../../../types/app';
import type { PrdFile, TaskMasterPanelProps, TaskMasterTask, TaskSelection } from '../../types/types';

const AnyTaskList = TaskList as any;
const AnyTaskDetail = TaskDetail as any;
const AnyPRDEditor = PRDEditor as any;

type TaskMasterContextValue = {
  tasks?: TaskMasterTask[];
  currentProject?: Project | null;
  refreshTasks?: (() => void) | null;
};

type PrdListResponse = {
  prdFiles?: PrdFile[];
  prds?: PrdFile[];
};

const PRD_SAVED_MESSAGE = 'PRD saved successfully!';

function getPrdFiles(data: PrdListResponse): PrdFile[] {
  return data.prdFiles || data.prds || [];
}

export default function TaskMasterPanel({ isVisible }: TaskMasterPanelProps) {
  const { tasks = [], currentProject, refreshTasks } = useTaskMaster() as TaskMasterContextValue;

  const [selectedTask, setSelectedTask] = useState<TaskMasterTask | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState(false);

  const [showPRDEditor, setShowPRDEditor] = useState(false);
  const [selectedPRD, setSelectedPRD] = useState<PrdFile | null>(null);
  const [existingPRDs, setExistingPRDs] = useState<PrdFile[]>([]);
  const [prdNotification, setPRDNotification] = useState<string | null>(null);

  const prdNotificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPrdNotification = useCallback((message: string) => {
    if (prdNotificationTimeoutRef.current) {
      clearTimeout(prdNotificationTimeoutRef.current);
    }

    setPRDNotification(message);
    prdNotificationTimeoutRef.current = setTimeout(() => {
      setPRDNotification(null);
      prdNotificationTimeoutRef.current = null;
    }, 3000);
  }, []);

  const loadExistingPrds = useCallback(async () => {
    if (!currentProject?.name) {
      setExistingPRDs([]);
      return;
    }

    try {
      const response = await api.get(`/taskmaster/prd/${encodeURIComponent(currentProject.name)}`);
      if (!response.ok) {
        setExistingPRDs([]);
        return;
      }

      const data = (await response.json()) as PrdListResponse;
      setExistingPRDs(getPrdFiles(data));
    } catch (error) {
      console.error('Failed to load existing PRDs:', error);
      setExistingPRDs([]);
    }
  }, [currentProject?.name]);

  const refreshPrds = useCallback(
    async (showNotification = false) => {
      await loadExistingPrds();

      if (showNotification) {
        showPrdNotification(PRD_SAVED_MESSAGE);
      }
    },
    [loadExistingPrds, showPrdNotification],
  );

  useEffect(() => {
    void loadExistingPrds();
  }, [loadExistingPrds]);

  useEffect(() => {
    return () => {
      if (prdNotificationTimeoutRef.current) {
        clearTimeout(prdNotificationTimeoutRef.current);
      }
    };
  }, []);

  const handleTaskClick = useCallback(
    (task: TaskSelection) => {
      if (!task || typeof task !== 'object' || !('id' in task)) {
        return;
      }

      if (!('title' in task) || !task.title) {
        const fullTask = tasks.find((candidate) => String(candidate.id) === String(task.id));
        if (fullTask) {
          setSelectedTask(fullTask);
          setShowTaskDetail(true);
        }
        return;
      }

      setSelectedTask(task as TaskMasterTask);
      setShowTaskDetail(true);
    },
    [tasks],
  );

  const handleTaskDetailClose = useCallback(() => {
    setShowTaskDetail(false);
    setSelectedTask(null);
  }, []);

  const handleTaskStatusChange = useCallback(
    (taskId: string | number, newStatus: string) => {
      console.log('Update task status:', taskId, newStatus);
      refreshTasks?.();
    },
    [refreshTasks],
  );

  const handleOpenPrdEditor = useCallback((prd: PrdFile | null = null) => {
    setSelectedPRD(prd);
    setShowPRDEditor(true);
  }, []);

  const handleClosePrdEditor = useCallback(() => {
    setShowPRDEditor(false);
    setSelectedPRD(null);
  }, []);

  const handlePrdSave = useCallback(async () => {
    handleClosePrdEditor();
    await refreshPrds(true);
    refreshTasks?.();
  }, [handleClosePrdEditor, refreshPrds, refreshTasks]);

  return (
    <>
      <div className={`h-full ${isVisible ? 'block' : 'hidden'}`}>
        <div className="h-full flex flex-col overflow-hidden">
          <AnyTaskList
            tasks={tasks}
            onTaskClick={handleTaskClick}
            showParentTasks
            className="flex-1 overflow-y-auto p-4"
            currentProject={currentProject}
            onTaskCreated={refreshTasks || undefined}
            onShowPRDEditor={handleOpenPrdEditor}
            existingPRDs={existingPRDs}
            onRefreshPRDs={(showNotification = false) => {
              void refreshPrds(showNotification);
            }}
          />
        </div>
      </div>

      {showTaskDetail && selectedTask && (
        <AnyTaskDetail
          task={selectedTask}
          isOpen={showTaskDetail}
          onClose={handleTaskDetailClose}
          onStatusChange={handleTaskStatusChange}
          onTaskClick={handleTaskClick}
        />
      )}

      {showPRDEditor && (
        <AnyPRDEditor
          project={currentProject}
          projectPath={currentProject?.fullPath || currentProject?.path}
          onClose={handleClosePrdEditor}
          isNewFile={!selectedPRD?.isExisting}
          file={{
            name: selectedPRD?.name || 'prd.txt',
            content: selectedPRD?.content || '',
          }}
          onSave={handlePrdSave}
        />
      )}

      {prdNotification && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
          <div className="bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">{prdNotification}</span>
          </div>
        </div>
      )}
    </>
  );
}
