import type { ComponentType } from 'react';

import type { PermissionPanelProps } from '@/shared/types';


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
