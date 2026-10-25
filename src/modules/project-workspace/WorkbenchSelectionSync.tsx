import { useEffect, useRef } from 'react';

import { useProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useWorkbenchSessions } from '@/modules/workbench-sessions';

/**
 * Rendered by ProjectWorkspaceShell: returns the main area to the regular project workspace when the user
 * picks a project or session in the sidebar while a Workbench session is showing. On phones it also
 * closes the sidebar drawer once a Workbench session is picked, so the session is visible.
 */
export default function WorkbenchSelectionSync({ isMobile }: { isMobile: boolean }) {
  const { selectedProject, selectedSession, setSidebarOpen } = useProjectMainState();
  const { selectedSessionId, selectSession } = useWorkbenchSessions();
  const projectId = selectedProject?.projectId ?? null;
  const sessionId = selectedSession?.id ?? null;
  // The project/session pair the user last had selected; a change in either means a deliberate navigation.
  const lastSelectionRef = useRef<string>(`${projectId}|${sessionId}`);

  useEffect(() => {
    const current = `${projectId}|${sessionId}`;
    if (current !== lastSelectionRef.current) {
      lastSelectionRef.current = current;
      if (selectedSessionId !== null) {
        selectSession(null);
      }
    }
  }, [projectId, sessionId, selectedSessionId, selectSession]);

  useEffect(() => {
    if (isMobile && selectedSessionId !== null) {
      setSidebarOpen(false);
    }
  }, [isMobile, selectedSessionId, setSidebarOpen]);

  return null;
}
