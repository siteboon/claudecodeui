import { useMemo } from 'react';
import type { ComponentType, SVGProps } from 'react';
import { MessageSquare, FolderTree, Eye, Monitor, MoreHorizontal } from 'lucide-react';

import type { AppTab } from '../../types/app';

export type AppNavSlot = 'chat' | 'sessions' | 'preview' | 'browser' | 'more';

export type AppNavItem = {
  slot: AppNavSlot;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Accent inherited by the section this slot navigates to. */
  accent: 'sky' | 'lavender' | 'mint' | 'peach' | 'butter' | 'blush';
};

export function useAppNavItems(): AppNavItem[] {
  return useMemo<AppNavItem[]>(() => [
    { slot: 'chat',     label: 'Chat',     Icon: MessageSquare,   accent: 'sky' },
    { slot: 'sessions', label: 'Sessions', Icon: FolderTree,      accent: 'lavender' },
    { slot: 'preview',  label: 'Preview',  Icon: Eye,             accent: 'mint' },
    { slot: 'browser',  label: 'Browser',  Icon: Monitor,         accent: 'peach' },
    { slot: 'more',     label: 'More',     Icon: MoreHorizontal,  accent: 'blush' },
  ], []);
}

export type AppNavState = {
  activeTab: AppTab;
  sidebarOpen: boolean;
};

/** Derive which nav slot is visually active from the current tab + sidebar state. */
export function resolveActiveSlot({ activeTab, sidebarOpen }: AppNavState): AppNavSlot {
  if (sidebarOpen) return 'sessions';
  if (activeTab === 'preview') return 'preview';
  if (activeTab === 'browser') return 'browser';
  return 'chat';
}
