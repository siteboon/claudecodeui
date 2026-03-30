import ReactDOM from 'react-dom';
import { AlertTriangle, Trash2 } from 'lucide-react';

import type {
  SessionDeleteTarget,
  WorkspaceDeleteTarget,
} from '@/components/refactored/sidebar/types';
import { Button } from '@/shared/view/ui';

type SidebarDeleteModalsProps = {
  workspaceDeleteTarget: WorkspaceDeleteTarget | null;
  sessionDeleteTarget: SessionDeleteTarget | null;
  onCancelWorkspaceDelete: () => void;
  onConfirmWorkspaceDelete: () => void;
  onCancelSessionDelete: () => void;
  onConfirmSessionDelete: () => void;
};

/**
 * Component layer (The Face)
 * Renders deletion confirmations with explicit file-removal messaging.
 */
export function SidebarDeleteModals({
  workspaceDeleteTarget,
  sessionDeleteTarget,
  onCancelWorkspaceDelete,
  onConfirmWorkspaceDelete,
  onCancelSessionDelete,
  onConfirmSessionDelete,
}: SidebarDeleteModalsProps) {
  return (
    <>
      {workspaceDeleteTarget &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                    <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-lg font-semibold text-foreground">Delete workspace</h3>
                    <p className="mb-2 text-sm text-muted-foreground">
                      Delete{' '}
                      <span className="font-medium text-foreground">
                        {workspaceDeleteTarget.workspaceName}
                      </span>
                      ?
                    </p>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                      <p className="text-sm font-medium text-red-700 dark:text-red-300">
                        {workspaceDeleteTarget.sessionCount} session
                        {workspaceDeleteTarget.sessionCount === 1 ? '' : 's'} and all associated
                        JSONL files will be deleted.
                      </p>
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        The workspace folder itself will stay on your system.
                      </p>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      This action cannot be undone.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 border-t border-border bg-muted/30 p-4">
                <Button variant="outline" className="flex-1" onClick={onCancelWorkspaceDelete}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 bg-red-600 text-white hover:bg-red-700"
                  onClick={onConfirmWorkspaceDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {sessionDeleteTarget &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                    <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-lg font-semibold text-foreground">Delete session</h3>
                    <p className="mb-2 text-sm text-muted-foreground">
                      Delete{' '}
                      <span className="font-medium text-foreground">
                        {sessionDeleteTarget.sessionName}
                      </span>
                      ?
                    </p>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                      <p className="text-sm font-medium text-red-700 dark:text-red-300">
                        The associated JSONL session file will also be deleted.
                      </p>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      This action cannot be undone.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 border-t border-border bg-muted/30 p-4">
                <Button variant="outline" className="flex-1" onClick={onCancelSessionDelete}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 bg-red-600 text-white hover:bg-red-700"
                  onClick={onConfirmSessionDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
