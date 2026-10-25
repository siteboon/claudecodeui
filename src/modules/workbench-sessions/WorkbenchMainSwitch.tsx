import type { ReactNode } from 'react';

import { useWorkbenchSessions } from '@/modules/workbench-sessions/context/WorkbenchSessionsContext';
import WorkbenchSessionView from '@/modules/workbench-sessions/WorkbenchSessionView';

type WorkbenchMainSwitchProps = {
  /** The regular project workspace; stays mounted (hidden) while a Workbench session is shown so its state survives. */
  children: ReactNode;
};

/** Rendered by project-workspace's ProjectWorkspaceShell around the main region: shows the selected Workbench session, otherwise the normal workspace. */
export default function WorkbenchMainSwitch({ children }: WorkbenchMainSwitchProps) {
  const { selectedSession } = useWorkbenchSessions();

  return (
    <>
      <div className={selectedSession ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>{children}</div>
      {selectedSession && (
        <div className="flex min-h-0 flex-1 flex-col">
          <WorkbenchSessionView session={selectedSession} />
        </div>
      )}
    </>
  );
}
