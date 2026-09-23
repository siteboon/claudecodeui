import { createContext, useContext } from 'react';

import type { PendingPermissionRequest } from '@/shared/types';

export type PermissionContextValue = {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  /** Answers a pending plan approval with Build, in the planning session or in a new one started from the plan. */
  buildPlan: (request: PendingPermissionRequest, inNewSession: boolean) => void;
};

const PermissionContext = createContext<PermissionContextValue | null>(null);

export function usePermission(): PermissionContextValue | null {
  return useContext(PermissionContext);
}

export default PermissionContext;
