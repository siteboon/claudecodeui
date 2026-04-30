import { actionsGroup } from './groups/actions';
import { commitsGroup } from './groups/commits';
import { filesGroup } from './groups/files';
import { gitGroup } from './groups/git';
import { navigateGroup } from './groups/navigate';
import { sessionsGroup } from './groups/sessions';
import { settingsGroup } from './groups/settings';
import type { GroupConfig } from './types';

export const GROUPS: GroupConfig[] = [
  actionsGroup,
  navigateGroup,
  gitGroup,
  settingsGroup,
  sessionsGroup,
  filesGroup,
  commitsGroup,
];

export function parseMode(input: string): { mode: string; query: string } {
  for (const g of GROUPS) {
    if (g.prefix && input.startsWith(g.prefix.char)) {
      return { mode: g.prefix.mode, query: input.slice(g.prefix.char.length) };
    }
  }
  return { mode: 'mixed', query: input };
}

export type { GroupConfig, PaletteCtx, PaletteItem } from './types';
