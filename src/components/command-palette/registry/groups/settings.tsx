import { SETTINGS_MAIN_TABS } from '../../../settings/constants/constants';
import type { GroupConfig } from '../types';

export const settingsGroup: GroupConfig = {
  id: 'settings',
  heading: 'Settings',
  modes: ['mixed', 'actions'],
  useItems: (ctx) =>
    SETTINGS_MAIN_TABS.map(({ id, label, keywords, icon: Icon }) => ({
      key: `settings-${id}`,
      value: `Settings ${label} ${keywords}`,
      onSelect: () => ctx.run(() => ctx.onOpenSettings(id)),
      node: (
        <>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1">Settings: {label}</span>
        </>
      ),
    })),
};
