import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { useProjectsState } from '@/modules/project-workspace/hooks/useProjectsState';
import type { IsSessionProcessing,ServerEvent } from '@/shared/types';

type ProjectsState = ReturnType<typeof useProjectsState>;

type ProjectSidebarState = Pick<
  ProjectsState,
  'sidebarOpen' | 'setSidebarOpen' | 'sidebarSharedProps'
>;

type ProjectMainState = Pick<
  ProjectsState,
  | 'selectedProject'
  | 'selectedSession'
  | 'activeTab'
  | 'setActiveTab'
  | 'setSidebarOpen'
  | 'isLoadingProjects'
  | 'openSettings'
  | 'externalMessageUpdate'
  | 'newSessionTrigger'
  | 'registerOptimisticSession'
  | 'handleProjectSelect'
  | 'refreshProjectsSilently'
>;

type ProjectCommandState = Pick<
  ProjectsState,
  'selectedProject' | 'handleNewSession' | 'openSettings' | 'setActiveTab'
>;

type ProjectEffectsState = Pick<
  ProjectsState,
  'openSettings' | 'refreshProjectsSilently' | 'setActiveTab' | 'setSidebarOpen'
>;

type ProjectActiveSessionState = {
  activeSessionId: string | null;
};

type ProjectsStateProviderProps = {
  children: ReactNode;
  sessionId?: string;
  navigate: NavigateFunction;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  isMobile: boolean;
  isSessionProcessing: IsSessionProcessing;
};

const ProjectSidebarContext = createContext<ProjectSidebarState | null>(null);
const ProjectMainContext = createContext<ProjectMainState | null>(null);
const ProjectCommandContext = createContext<ProjectCommandState | null>(null);
const ProjectEffectsContext = createContext<ProjectEffectsState | null>(null);
const ProjectActiveSessionContext = createContext<ProjectActiveSessionState | null>(null);

/** Rendered by ProjectWorkspaceRoute to own the workspace's project and session state and expose it through this module's context hooks. */
export function ProjectsStateProvider({
  children,
  sessionId,
  navigate,
  subscribe,
  isMobile,
  isSessionProcessing,
}: ProjectsStateProviderProps) {
  const state = useProjectsState({
    sessionId,
    navigate,
    subscribe,
    isMobile,
    isSessionProcessing,
  });

  const sidebarState = useMemo<ProjectSidebarState>(
    () => ({
      sidebarOpen: state.sidebarOpen,
      setSidebarOpen: state.setSidebarOpen,
      sidebarSharedProps: state.sidebarSharedProps,
    }),
    [state.sidebarOpen, state.setSidebarOpen, state.sidebarSharedProps],
  );

  const mainState = useMemo<ProjectMainState>(
    () => ({
      selectedProject: state.selectedProject,
      selectedSession: state.selectedSession,
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
      setSidebarOpen: state.setSidebarOpen,
      isLoadingProjects: state.isLoadingProjects,
      openSettings: state.openSettings,
      externalMessageUpdate: state.externalMessageUpdate,
      newSessionTrigger: state.newSessionTrigger,
      registerOptimisticSession: state.registerOptimisticSession,
      handleProjectSelect: state.handleProjectSelect,
      refreshProjectsSilently: state.refreshProjectsSilently,
    }),
    [
      state.activeTab,
      state.externalMessageUpdate,
      state.handleProjectSelect,
      state.isLoadingProjects,
      state.newSessionTrigger,
      state.openSettings,
      state.refreshProjectsSilently,
      state.registerOptimisticSession,
      state.selectedProject,
      state.selectedSession,
      state.setActiveTab,
      state.setSidebarOpen,
    ],
  );

  const commandState = useMemo<ProjectCommandState>(
    () => ({
      selectedProject: state.selectedProject,
      handleNewSession: state.handleNewSession,
      openSettings: state.openSettings,
      setActiveTab: state.setActiveTab,
    }),
    [state.handleNewSession, state.openSettings, state.selectedProject, state.setActiveTab],
  );

  const effectsState = useMemo<ProjectEffectsState>(
    () => ({
      openSettings: state.openSettings,
      refreshProjectsSilently: state.refreshProjectsSilently,
      setActiveTab: state.setActiveTab,
      setSidebarOpen: state.setSidebarOpen,
    }),
    [
      state.openSettings,
      state.refreshProjectsSilently,
      state.setActiveTab,
      state.setSidebarOpen,
    ],
  );

  const activeSessionState = useMemo<ProjectActiveSessionState>(
    () => ({ activeSessionId: state.selectedSession?.id ?? sessionId ?? null }),
    [sessionId, state.selectedSession?.id],
  );

  return (
    <ProjectEffectsContext.Provider value={effectsState}>
      <ProjectCommandContext.Provider value={commandState}>
        <ProjectMainContext.Provider value={mainState}>
          <ProjectSidebarContext.Provider value={sidebarState}>
            <ProjectActiveSessionContext.Provider value={activeSessionState}>
              {children}
            </ProjectActiveSessionContext.Provider>
          </ProjectSidebarContext.Provider>
        </ProjectMainContext.Provider>
      </ProjectCommandContext.Provider>
    </ProjectEffectsContext.Provider>
  );
}

function useRequiredProjectContext<T>(value: T | null, hookName: string): T {
  if (!value) {
    throw new Error(`${hookName} must be used within ProjectsStateProvider`);
  }
  return value;
}

export function useProjectSidebarState(): ProjectSidebarState {
  return useRequiredProjectContext(useContext(ProjectSidebarContext), 'useProjectSidebarState');
}

export function useProjectMainState(): ProjectMainState {
  return useRequiredProjectContext(useContext(ProjectMainContext), 'useProjectMainState');
}

export function useProjectCommandState(): ProjectCommandState {
  return useRequiredProjectContext(useContext(ProjectCommandContext), 'useProjectCommandState');
}

export function useProjectEffectsState(): ProjectEffectsState {
  return useRequiredProjectContext(useContext(ProjectEffectsContext), 'useProjectEffectsState');
}

export function useProjectActiveSessionState(): ProjectActiveSessionState {
  return useRequiredProjectContext(
    useContext(ProjectActiveSessionContext),
    'useProjectActiveSessionState',
  );
}
