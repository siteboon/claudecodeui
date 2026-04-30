import { MessageSquarePlus, Settings, SunMoon } from 'lucide-react';

import type { GroupConfig } from '../types';

export const actionsGroup: GroupConfig = {
  id: 'actions',
  heading: 'Actions',
  modes: ['mixed', 'actions'],
  prefix: { char: '> ', mode: 'actions' },
  useItems: (ctx) => {
    const startDisabled = !ctx.selectedProject;
    return [
      {
        key: 'start-new-chat',
        value: 'Start new chat',
        disabled: startDisabled,
        onSelect: () => {
          if (!ctx.selectedProject) return;
          ctx.run(() => ctx.onStartNewChat(ctx.selectedProject!));
        },
        node: (
          <>
            <MessageSquarePlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">Start new chat</span>
            {startDisabled && (
              <span className="text-xs text-muted-foreground">Select a project first</span>
            )}
          </>
        ),
      },
      {
        key: 'open-settings',
        value: 'Open settings',
        onSelect: () => ctx.run(() => ctx.onOpenSettings()),
        node: (
          <>
            <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">Open settings</span>
          </>
        ),
      },
      {
        key: 'toggle-theme',
        value: 'Toggle theme dark light mode',
        onSelect: () => ctx.run(ctx.toggleDarkMode),
        node: (
          <>
            <SunMoon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">Toggle theme</span>
          </>
        ),
      },
    ];
  },
};
