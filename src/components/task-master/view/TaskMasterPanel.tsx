import { useCallback, useEffect, useRef, useState } from 'react';
import PRDEditor from '../../prd-editor';
import { useTaskMaster } from '../context/TaskMasterContext';
import { useProjectPrdFiles } from '../hooks/useProjectPrdFiles';
import type { PrdFile, TaskMasterTask, TaskSelection } from '../types';
import TaskBoard from './TaskBoard';
import TaskDetailModal from './TaskDetailModal';

type TaskMasterPanelProps = {
  isVisible: boolean;
};

const PRD_SAVE_MESSAGE = 'PRD saved successfully!';

export default function TaskMasterPanel({ isVisible }: TaskMasterPanelProps) {
  const { tasks, currentProject, refreshTasks } = useTaskMaster();

  const [selectedTask, setSelectedTask] = useState<TaskMasterTask | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);

  const [isPrdEditorOpen, setIsPrdEditorOpen] = useState(false);
  const [selectedPrd, setSelectedPrd] = useState<PrdFile | null>(null);

  const [prdNotification, setPrdNotification] = useState<string | null>(null);
  const notificationTimeoutRef = useRef<number | null>(null);

  const { prdFiles, refreshPrdFiles } = useProjectPrdFiles({ projectId: currentProject?.projectId });

  const showPrdNotification = useCallback((message: string) => {
    if (notificationTimeoutRef.current) {
      window.clearTimeout(notificationTimeoutRef.current);
    }

    setPrdNotification(message);

    notificationTimeoutRef.current = window.setTimeout(() => {
      setPrdNotification(null);
      notificationTimeoutRef.current = null;
    }, 3000);
  }, []);

  const refreshPrdData = useCallback(
    async (showNotification = false) => {
      await refreshPrdFiles();
      if (showNotification) {
        showPrdNotification(PRD_SAVE_MESSAGE);
      }
    },
    [refreshPrdFiles, showPrdNotification],
  );

  useEffect(() => {
    return () => {
      if (notificationTimeoutRef.current) {
        window.clearTimeout(notificationTimeoutRef.current);
      }
    };
  }, []);

  const handleTaskClick = useCallback(
    (taskSelection: TaskSelection) => {
      const selectedId = String(taskSelection.id);

      if (!taskSelection.title) {
        const fullTask = tasks.find((task) => String(task.id) === selectedId) ?? null;
        if (fullTask) {
          setSelectedTask(fullTask);
          setIsTaskDetailOpen(true);
        }
        return;
      }

      setSelectedTask(taskSelection as TaskMasterTask);
      setIsTaskDetailOpen(true);
    },
    [tasks],
  );

  return (
    <>
      <div className={`h-full ${isVisible ? 'block' : 'hidden'}`}>
        <div className="flex h-full flex-col overflow-hidden">
          <TaskBoard
            tasks={tasks}
            onTaskClick={handleTaskClick}
            showParentTasks
            className="flex-1 overflow-y-auto p-4"
            currentProject={currentProject}
            onTaskCreated={refreshTasks}
            onShowPRDEditor={(prd) => {
              setSelectedPrd(prd ?? null);
              setIsPrdEditorOpen(true);
            }}
            existingPRDs={prdFiles}
            onRefreshPRDs={(showNotification = false) => {
              void refreshPrdData(showNotification);
            }}
          />
        </div>
      </div>

      <TaskDetailModal
        task={selectedTask}
        isOpen={isTaskDetailOpen}
        onClose={() => {
          setIsTaskDetailOpen(false);
          setSelectedTask(null);
        }}
        onStatusChange={() => {
          void refreshTasks();
        }}
        onTaskClick={handleTaskClick}
      />

      {isPrdEditorOpen && (
        <PRDEditor
          project={currentProject}
          projectPath={currentProject?.fullPath || currentProject?.path}
          onClose={() => {
            setIsPrdEditorOpen(false);
            setSelectedPrd(null);
          }}
          isNewFile={!selectedPrd?.isExisting}
          file={{
            name: selectedPrd?.name || 'prd.txt',
            content: selectedPrd?.content || '',
            isExisting: selectedPrd?.isExisting,
          }}
          onSave={async () => {
            setIsPrdEditorOpen(false);
            setSelectedPrd(null);
            await refreshPrdData(true);
            await refreshTasks();
          }}
        />
      )}

      {prdNotification && (
        <div className="animate-in slide-in-from-bottom-2 fixed bottom-4 right-4 z-50 duration-300">
          <div className="flex items-center gap-3 rounded-lg bg-green-600 px-4 py-3 text-white shadow-lg">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">{prdNotification}</span>
          </div>
        </div>
      )}
    </>
  );
}
