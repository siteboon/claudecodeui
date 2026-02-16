import type { ComponentType } from 'react';
import type { PendingPermissionRequest } from '../../types/types';

export interface PermissionPanelProps {
  request: PendingPermissionRequest;
  onDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; updatedInput?: unknown },
  ) => void;
}

const registry: Record<string, ComponentType<PermissionPanelProps>> = {};

export function registerPermissionPanel(
  toolName: string,
  component: ComponentType<PermissionPanelProps>,
): void {
  registry[toolName] = component;
}

export function getPermissionPanel(
  toolName: string,
): ComponentType<PermissionPanelProps> | null {
  return registry[toolName] || null;
}
