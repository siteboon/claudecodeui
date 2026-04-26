# Sidebar Worktree Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-level `RepoGroup → Project → Sessions` sidebar nesting with a flat `Repo → RECENT (sessions) + WORKTREES (linked worktrees)` layout, while preserving all existing controller behavior (selection, editing, deletion, search, etc.).

**Architecture:** Keep `useSidebarController`, `groupProjectsByRepo`, and existing data flow untouched. Replace the rendering path under `SidebarProjectList` with new components: a `RepoCard` that owns one repo group, a `RecentSessions` block that aggregates sessions across all worktrees of a repo, a `WorktreeRow` for linked worktrees, a primary `NewSessionRow`, and a shared `BranchChip` primitive. Add small pure utilities to aggregate sessions across a repo and to derive a deterministic chip color from a branch name.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, lucide-react icons, Vitest (utility tests only — no DOM test infra), `i18next` for strings.

**Spec:** `docs/superpowers/specs/2026-04-25-sidebar-worktree-redesign-design.md`

---

## File Structure

**New files (all under `src/components/sidebar/`):**

| Path | Responsibility |
|------|----------------|
| `utils/repoAggregates.ts` | Pure helpers: `getRepoSessions`, `getRepoSessionTotal`, `branchChipColorIndex` |
| `utils/__tests__/repoAggregates.test.ts` | Vitest tests for the above |
| `view/subcomponents/BranchChip.tsx` | Shared chip primitive with deterministic color |
| `view/subcomponents/NewSessionRow.tsx` | Green "+ New session" primary CTA |
| `view/subcomponents/WorktreeRow.tsx` | One linked-worktree row inside the WORKTREES section |
| `view/subcomponents/RecentSessions.tsx` | Recency-sorted session list across one repo |
| `view/subcomponents/RepoCard.tsx` | Composes header + new-session + RECENT + WORKTREES |

**Modified files:**

| Path | Change |
|------|--------|
| `view/subcomponents/SidebarProjectList.tsx` | Render every group/standalone via `RepoCard`. Remove direct `SidebarProjectItem` path. |
| `i18n/locales/en/sidebar.json` (and other locales) | Add `projects.recent`, `projects.worktrees`, `projects.newSession`, `projects.showAll`, `projects.emptyWorktree` |
| `src/hooks/useProjectsState.ts` | Update `handleNewSession` to honor explicit worktree target when called from the per-worktree "+" |

**Files to delete (after `RepoCard` works end-to-end):**

- `view/subcomponents/SidebarRepoGroup.tsx`
- `view/subcomponents/SidebarProjectItem.tsx`
- `view/subcomponents/SidebarProjectSessions.tsx`
- `view/subcomponents/SidebarSessionItem.tsx`

(Their behavior is folded into the new components.)

---

## Conventions used throughout

- **Imports** match the codebase style: relative paths, `lucide-react` icons, `cn` from `../../../lib/utils`, `Button` from `../../../shared/view/ui` where idiomatic.
- **Strings** never hardcoded — use `t('projects.something')` with sensible `defaultValue`.
- **Tailwind** matches existing palette (`text-muted-foreground`, `bg-accent`, `text-primary`). Branch chips reuse the `bg-{color}-50 text-{color}-600 dark:bg-{color}-900/30 dark:text-{color}-400` formula already in `SidebarProjectItem.tsx:103-105`.
- **No emojis.** Lucide icons only.
- **Component props are explicit** — no spreading `{...sharedProps}` blindly except where the existing pattern already does it (`SidebarProjectList.tsx`).
- **Run all tests** with `npm test` (root). Watch with `npm run test:watch`.

---

## Task 1: Aggregate session helpers (TDD)

**Files:**
- Create: `src/components/sidebar/utils/repoAggregates.ts`
- Create: `src/components/sidebar/utils/__tests__/repoAggregates.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/sidebar/utils/__tests__/repoAggregates.test.ts
import { describe, it, expect } from 'vitest';
import type { Project } from '../../../../types/app';
import {
  getRepoSessions,
  getRepoSessionTotal,
  branchChipColorIndex,
} from '../repoAggregates';

const makeProject = (overrides: Partial<Project> & { name: string }): Project => ({
  displayName: overrides.name,
  fullPath: `/tmp/${overrides.name}`,
  ...overrides,
});

describe('getRepoSessions', () => {
  it('returns sessions across all projects in a repo, sorted by recency descending', () => {
    const main = makeProject({
      name: 'main',
      sessions: [
        { id: 'a', lastActivity: '2026-04-25T10:00:00Z' } as never,
        { id: 'b', lastActivity: '2026-04-25T08:00:00Z' } as never,
      ],
    });
    const wt = makeProject({
      name: 'wt',
      sessions: [{ id: 'c', lastActivity: '2026-04-25T09:00:00Z' } as never],
    });

    const result = getRepoSessions([main, wt], {});
    expect(result.map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('attaches __projectName so the caller knows which worktree owns each session', () => {
    const main = makeProject({
      name: 'main',
      sessions: [{ id: 'a', lastActivity: '2026-04-25T10:00:00Z' } as never],
    });
    const wt = makeProject({
      name: 'wt',
      sessions: [{ id: 'b', lastActivity: '2026-04-25T09:00:00Z' } as never],
    });

    const result = getRepoSessions([main, wt], {});
    expect(result[0].__projectName).toBe('main');
    expect(result[1].__projectName).toBe('wt');
  });

  it('respects additionalSessions for paginated entries', () => {
    const main = makeProject({
      name: 'main',
      sessions: [{ id: 'a', lastActivity: '2026-04-25T10:00:00Z' } as never],
    });

    const result = getRepoSessions([main], {
      main: [{ id: 'extra', lastActivity: '2026-04-25T11:00:00Z' } as never],
    });
    expect(result.map((s) => s.id)).toEqual(['extra', 'a']);
  });

  it('returns [] when no projects have sessions', () => {
    const main = makeProject({ name: 'main', sessions: [] });
    expect(getRepoSessions([main], {})).toEqual([]);
  });
});

describe('getRepoSessionTotal', () => {
  it('sums sessionMeta.total across projects, falling back to sessions length', () => {
    const main = makeProject({
      name: 'main',
      sessions: [{ id: 'a' } as never, { id: 'b' } as never],
      sessionMeta: { total: 8 },
    });
    const wt = makeProject({
      name: 'wt',
      sessions: [{ id: 'c' } as never],
    });

    expect(getRepoSessionTotal([main, wt])).toBe(9); // 8 + 1
  });
});

describe('branchChipColorIndex', () => {
  it('returns the same index for the same branch name', () => {
    expect(branchChipColorIndex('main')).toBe(branchChipColorIndex('main'));
  });

  it('returns a value in [0, paletteSize)', () => {
    for (const branch of ['main', 'feat/x', 'fix/y', 'release/v1', '']) {
      const v = branchChipColorIndex(branch);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- repoAggregates
```

Expected: FAIL — `Cannot find module '../repoAggregates'`.

- [ ] **Step 3: Implement the helpers**

```ts
// src/components/sidebar/utils/repoAggregates.ts
import type { Project } from '../../../types/app';
import type {
  AdditionalSessionsByProject,
  SessionWithProvider,
} from '../types/types';
import { getAllSessions, getSessionDate } from './utils';

const PALETTE_SIZE = 5;

/**
 * Collect every session across the given projects (treated as one repo's
 * worktrees) and sort by recency descending. Each returned session carries
 * `__projectName` so the caller can route clicks to the correct worktree.
 */
export const getRepoSessions = (
  projects: Project[],
  additionalSessions: AdditionalSessionsByProject,
): (SessionWithProvider & { __projectName: string })[] => {
  const all: (SessionWithProvider & { __projectName: string })[] = [];
  for (const project of projects) {
    for (const session of getAllSessions(project, additionalSessions)) {
      all.push({ ...session, __projectName: project.name });
    }
  }
  all.sort((a, b) => getSessionDate(b).getTime() - getSessionDate(a).getTime());
  return all;
};

/**
 * Total session count across a repo, preferring `sessionMeta.total` (which the
 * server may report as larger than the loaded `sessions` array).
 */
export const getRepoSessionTotal = (projects: Project[]): number => {
  let total = 0;
  for (const project of projects) {
    const fromMeta = typeof project.sessionMeta?.total === 'number'
      ? (project.sessionMeta.total as number)
      : undefined;
    total += fromMeta ?? project.sessions?.length ?? 0;
  }
  return total;
};

/**
 * Deterministic palette index from a branch name. Used to keep "feat/foo"
 * the same color everywhere it appears in the sidebar.
 */
export const branchChipColorIndex = (branchName: string): number => {
  let hash = 0;
  for (let i = 0; i < branchName.length; i += 1) {
    hash = (hash * 31 + branchName.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % PALETTE_SIZE;
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- repoAggregates
```

Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/utils/repoAggregates.ts \
        src/components/sidebar/utils/__tests__/repoAggregates.test.ts
git commit -m "feat(sidebar): add repo-scoped session aggregation helpers"
```

---

## Task 2: BranchChip primitive

**Files:**
- Create: `src/components/sidebar/view/subcomponents/BranchChip.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/sidebar/view/subcomponents/BranchChip.tsx
import { GitBranch } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { branchChipColorIndex } from '../../utils/repoAggregates';

const PALETTE = [
  'bg-green-50  text-green-600  dark:bg-green-900/30  dark:text-green-400  border-green-200  dark:border-green-900/40',
  'bg-blue-50   text-blue-600   dark:bg-blue-900/30   dark:text-blue-400   border-blue-200   dark:border-blue-900/40',
  'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-900/40',
  'bg-amber-50  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400  border-amber-200  dark:border-amber-900/40',
  'bg-pink-50   text-pink-600   dark:bg-pink-900/30   dark:text-pink-400   border-pink-200   dark:border-pink-900/40',
];

const NEUTRAL =
  'bg-muted text-muted-foreground border-border';

type BranchChipProps = {
  branchName?: string | null;
  /** When true, the chip reads as "the current/checked-out branch" — slightly bolder. */
  emphasized?: boolean;
  className?: string;
};

export default function BranchChip({ branchName, emphasized, className }: BranchChipProps) {
  if (!branchName) {
    return null;
  }

  const palette = PALETTE[branchChipColorIndex(branchName)];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none font-medium',
        palette ?? NEUTRAL,
        emphasized && 'font-semibold',
        className,
      )}
      title={branchName}
    >
      <GitBranch className="h-2.5 w-2.5" />
      <span className="truncate max-w-[140px]">{branchName}</span>
    </span>
  );
}
```

- [ ] **Step 2: Build to confirm types compile**

```bash
npx tsc --noEmit
```

Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/view/subcomponents/BranchChip.tsx
git commit -m "feat(sidebar): add BranchChip primitive with deterministic color"
```

---

## Task 3: NewSessionRow primary CTA

**Files:**
- Create: `src/components/sidebar/view/subcomponents/NewSessionRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/sidebar/view/subcomponents/NewSessionRow.tsx
import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';

type NewSessionRowProps = {
  onClick: () => void;
  t: TFunction;
  className?: string;
};

export default function NewSessionRow({ onClick, t, className }: NewSessionRowProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg border border-dashed border-green-300/40 bg-green-50/40 px-3 py-2 text-left text-sm font-medium text-green-700 transition-all',
        'hover:border-green-400 hover:border-solid hover:bg-green-50/80',
        'dark:border-green-900/40 dark:bg-green-900/10 dark:text-green-400 dark:hover:border-green-800 dark:hover:bg-green-900/20',
        className,
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white dark:bg-green-700">
        <Plus className="h-3 w-3" strokeWidth={3} />
      </span>
      <span>{t('projects.newSession', { defaultValue: 'New session' })}</span>
    </button>
  );
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/view/subcomponents/NewSessionRow.tsx
git commit -m "feat(sidebar): add NewSessionRow primary CTA"
```

---

## Task 4: WorktreeRow component

**Files:**
- Create: `src/components/sidebar/view/subcomponents/WorktreeRow.tsx`

This row is intentionally lighter than the old `SidebarProjectItem`. It has no rename/delete affordances — those move to the repo-header `...` menu, which is **out of scope** for this redesign and tracked separately. For now, dropping per-worktree rename/delete is acceptable: rename was rare and delete-from-sidebar for worktrees is not in the merged feature set.

- [ ] **Step 1: Write the component**

```tsx
// src/components/sidebar/view/subcomponents/WorktreeRow.tsx
import { ChevronRight, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import BranchChip from './BranchChip';

type WorktreeRowProps = {
  project: Project;
  isActive: boolean;
  sessionCount: number;
  lastActivityLabel: string | null;
  onOpen: (project: Project) => void;
  onNewSessionInWorktree: (project: Project) => void;
  t: TFunction;
};

export default function WorktreeRow({
  project,
  isActive,
  sessionCount,
  lastActivityLabel,
  onOpen,
  onNewSessionInWorktree,
  t,
}: WorktreeRowProps) {
  const isDormant = sessionCount === 0;
  const isStale = Boolean(project.isStale);
  const isMuted = isDormant || isStale;

  const metaText = isStale
    ? t('projects.staleWorktree', { defaultValue: 'archived' })
    : isDormant
      ? t('projects.emptyWorktree', { defaultValue: 'empty · click to start' })
      : `${sessionCount} ${t('projects.sessionsShort', {
          defaultValue: sessionCount === 1 ? 'session' : 'sessions',
          count: sessionCount,
        })}${lastActivityLabel ? ` · ${lastActivityLabel}` : ''}`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(project)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(project);
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
        'hover:bg-accent/50',
        isActive && 'bg-accent text-accent-foreground',
        isMuted && 'opacity-60',
      )}
      title={project.fullPath}
    >
      <BranchChip branchName={project.worktreeInfo?.branchName ?? project.displayName} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
        {metaText}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onNewSessionInWorktree(project);
        }}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent hover:text-foreground',
        )}
        title={t('tooltips.newSessionInWorktree', {
          defaultValue: 'New session in this worktree',
        })}
        aria-label={t('tooltips.newSessionInWorktree', {
          defaultValue: 'New session in this worktree',
        })}
      >
        <Plus className="h-3 w-3" />
      </button>
      <ChevronRight
        className={cn(
          'h-3 w-3 text-muted-foreground/60 transition-opacity',
          'opacity-0 group-hover:opacity-100',
        )}
        aria-hidden
      />
    </div>
  );
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/view/subcomponents/WorktreeRow.tsx
git commit -m "feat(sidebar): add WorktreeRow component (no chevron, click=open latest)"
```

---

## Task 5: RecentSessions component

**Files:**
- Create: `src/components/sidebar/view/subcomponents/RecentSessions.tsx`

Reuses the existing `createSessionViewModel` from `utils/utils.ts` for time formatting and active-bullet logic.

- [ ] **Step 1: Write the component**

```tsx
// src/components/sidebar/view/subcomponents/RecentSessions.tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import BranchChip from './BranchChip';

const DEFAULT_VISIBLE = 5;

type RepoSession = SessionWithProvider & { __projectName: string };

type RecentSessionsProps = {
  sessions: RepoSession[];
  totalCount: number;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  /** name → Project lookup so we can show the right branch chip and route clicks. */
  projectsByName: Record<string, Project>;
  onSessionClick: (session: SessionWithProvider, projectName: string) => void;
  t: TFunction;
};

export default function RecentSessions({
  sessions,
  totalCount,
  selectedSession,
  currentTime,
  projectsByName,
  onSessionClick,
  t,
}: RecentSessionsProps) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const visible = showAll ? sessions : sessions.slice(0, DEFAULT_VISIBLE);
  const hidden = sessions.length - visible.length;

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="md:space-y-0.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span>{t('projects.recent', { defaultValue: 'Recent' })}</span>
        <span className="text-muted-foreground/60">· {totalCount}</span>
        {expanded && hidden > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              setShowAll(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setShowAll(true);
              }
            }}
            className="ml-auto rounded px-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground hover:text-foreground"
          >
            {t('projects.showAll', { defaultValue: 'Show all' })} {totalCount}
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-0.5">
          {visible.map((session) => {
            const project = projectsByName[session.__projectName];
            const branchName = project?.worktreeInfo?.branchName ?? null;
            const view = createSessionViewModel(session, currentTime, t);
            const isSelected = selectedSession?.id === session.id;

            return (
              <button
                key={`${session.__projectName}-${session.id}`}
                type="button"
                onClick={() => onSessionClick(session, session.__projectName)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  'hover:bg-accent/50',
                  isSelected && 'bg-accent text-accent-foreground',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    view.isActive
                      ? 'bg-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.15)]'
                      : 'bg-muted-foreground/30',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {view.sessionName}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {formatRelative(session, currentTime, t)}
                    {view.messageCount > 0 && (
                      <>
                        {' · '}
                        {view.messageCount} {t('projects.messages', { defaultValue: 'messages' })}
                      </>
                    )}
                  </span>
                </span>
                <BranchChip branchName={branchName} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatRelative(session: SessionWithProvider, now: Date, t: TFunction): string {
  const date = new Date(
    session.lastActivity || session.createdAt || 0,
  );
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t('time.justNow', { defaultValue: 'just now' });
  if (minutes < 60) return t('time.minutesAgo', { defaultValue: '{{count}}m ago', count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { defaultValue: '{{count}}h ago', count: hours });
  const days = Math.floor(hours / 24);
  return t('time.daysAgo', { defaultValue: '{{count}}d ago', count: days });
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/view/subcomponents/RecentSessions.tsx
git commit -m "feat(sidebar): add RecentSessions component (repo-scoped, recency-sorted)"
```

---

## Task 6: RepoCard composition

**Files:**
- Create: `src/components/sidebar/view/subcomponents/RepoCard.tsx`

This component owns one repo group: header + new-session row + RECENT + WORKTREES. It accepts both standalone projects and repo groups via a uniform interface.

- [ ] **Step 1: Write the component**

```tsx
// src/components/sidebar/view/subcomponents/RepoCard.tsx
import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { TFunction } from 'i18next';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type {
  AdditionalSessionsByProject,
  SessionWithProvider,
} from '../../types/types';
import { getRepoSessions, getRepoSessionTotal } from '../../utils/repoAggregates';
import BranchChip from './BranchChip';
import NewSessionRow from './NewSessionRow';
import RecentSessions from './RecentSessions';
import WorktreeRow from './WorktreeRow';

type RepoCardProps = {
  /** All projects belonging to this repo. For standalones it's a 1-element array. */
  projects: Project[];
  /** The "main" project — the repo's primary checkout. */
  mainProject: Project;
  /** Linked worktrees only (excludes main). Empty for standalones. */
  linkedWorktrees: Project[];
  isExpanded: boolean;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  additionalSessions: AdditionalSessionsByProject;
  currentTime: Date;
  onToggle: () => void;
  onNewSession: (project: Project) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  t: TFunction;
};

export default function RepoCard({
  projects,
  mainProject,
  linkedWorktrees,
  isExpanded,
  selectedProject,
  selectedSession,
  additionalSessions,
  currentTime,
  onToggle,
  onNewSession,
  onProjectSelect,
  onSessionSelect,
  t,
}: RepoCardProps) {
  const repoSessions = useMemo(
    () => getRepoSessions(projects, additionalSessions),
    [projects, additionalSessions],
  );
  const sessionTotal = useMemo(() => getRepoSessionTotal(projects), [projects]);
  const projectsByName = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.name, p])),
    [projects],
  );

  // Active worktrees first, stale ones at the bottom.
  const sortedWorktrees = useMemo(() => {
    const active = linkedWorktrees.filter((p) => !p.isStale);
    const stale = linkedWorktrees.filter((p) => p.isStale);
    return [...active, ...stale];
  }, [linkedWorktrees]);

  const isMainSelected = selectedProject?.name === mainProject.name;
  const branchName = mainProject.worktreeInfo?.branchName ?? null;

  const handleHeaderClick = () => {
    onProjectSelect(mainProject);
    onToggle();
  };

  return (
    <div className="md:space-y-0.5">
      {/* Repo header */}
      <button
        type="button"
        onClick={handleHeaderClick}
        className={cn(
          'group flex w-full items-center gap-2 rounded-lg border border-border/40 bg-card/60 px-2.5 py-2 text-left transition-colors',
          'hover:bg-accent/40',
          isMainSelected && 'bg-accent text-accent-foreground',
        )}
        aria-expanded={isExpanded}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Folder className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {mainProject.displayName}
            </span>
            <BranchChip branchName={branchName} emphasized />
          </div>
          <div className="text-[10px] text-muted-foreground">
            {sessionTotal} {t('projects.sessionsShort', { defaultValue: 'sessions', count: sessionTotal })}
            {linkedWorktrees.length > 0 && (
              <>
                {' · '}
                {linkedWorktrees.length}{' '}
                {t('projects.worktrees', {
                  defaultValue: linkedWorktrees.length === 1 ? 'worktree' : 'worktrees',
                  count: linkedWorktrees.length,
                })}
              </>
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-1 pt-1">
          <NewSessionRow onClick={() => onNewSession(mainProject)} t={t} />

          <RecentSessions
            sessions={repoSessions}
            totalCount={sessionTotal}
            selectedSession={selectedSession}
            currentTime={currentTime}
            projectsByName={projectsByName}
            onSessionClick={onSessionSelect}
            t={t}
          />

          {linkedWorktrees.length > 0 && (
            <div className="md:space-y-0.5">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
                <span>{t('projects.worktreesUpper', { defaultValue: 'Worktrees' })}</span>
                <span className="text-muted-foreground/60">· {linkedWorktrees.length}</span>
              </div>
              {sortedWorktrees.map((wt) => (
                <WorktreeRow
                  key={wt.name}
                  project={wt}
                  isActive={selectedProject?.name === wt.name}
                  sessionCount={getRepoSessionTotal([wt])}
                  lastActivityLabel={lastActivityLabelFor(wt, additionalSessions, currentTime, t)}
                  onOpen={(project) => {
                    const sessions = getRepoSessions([project], additionalSessions);
                    if (sessions.length > 0) {
                      onSessionSelect(sessions[0], project.name);
                    } else {
                      onNewSession(project);
                    }
                  }}
                  onNewSessionInWorktree={onNewSession}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function lastActivityLabelFor(
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
  now: Date,
  t: TFunction,
): string | null {
  const sessions = getRepoSessions([project], additionalSessions);
  if (sessions.length === 0) return null;
  const latest = sessions[0];
  const date = new Date(latest.lastActivity || latest.createdAt || 0);
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t('time.minutesAgo', { defaultValue: '{{count}}m ago', count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { defaultValue: '{{count}}h ago', count: hours });
  const days = Math.floor(hours / 24);
  return t('time.daysAgo', { defaultValue: '{{count}}d ago', count: days });
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/view/subcomponents/RepoCard.tsx
git commit -m "feat(sidebar): add RepoCard composing header + new + recent + worktrees"
```

---

## Task 7: Wire SidebarProjectList to RepoCard

**Files:**
- Modify: `src/components/sidebar/view/subcomponents/SidebarProjectList.tsx`

The new path renders every entry — standalone OR repo group — through `RepoCard`. We pass `additionalSessions` down from the controller (currently it lives in `useSidebarController` but isn't forwarded; we must thread it through `SidebarProjectListProps`).

- [ ] **Step 1: Add `additionalSessions` to `SidebarProjectListProps`**

In `src/components/sidebar/view/subcomponents/SidebarProjectList.tsx`, add to the props type:

```ts
import type {
  AdditionalSessionsByProject,
  // existing imports...
} from '../../types/types';

export type SidebarProjectListProps = {
  // ...existing fields...
  additionalSessions: AdditionalSessionsByProject;
  // ...rest unchanged...
};
```

- [ ] **Step 2: Replace the body of `SidebarProjectList`**

Replace the `return (...)` block:

```tsx
  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1.5">
      {!showProjects
        ? state
        : groupedItems.map((item) => {
            const projectsInGroup = isRepoGroup(item) ? item.projects : [item];
            const main = isRepoGroup(item)
              ? (item.projects.find((p) => p.isMainWorktree) ?? item.projects[0])
              : item;
            const linkedWorktrees = isRepoGroup(item)
              ? item.projects.filter((p) => p.name !== main.name)
              : [];

            return (
              <RepoCard
                key={isRepoGroup(item) ? `repo-group:${item.repoRoot}` : item.name}
                projects={projectsInGroup}
                mainProject={main}
                linkedWorktrees={linkedWorktrees}
                isExpanded={expandedProjects.has(main.name)}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                additionalSessions={additionalSessions}
                currentTime={currentTime}
                onToggle={() => onToggleProject(main.name)}
                onNewSession={onNewSession}
                onProjectSelect={onProjectSelect}
                onSessionSelect={onSessionSelect}
                t={t}
              />
            );
          })}
    </div>
  );
```

Add the import at the top:

```ts
import RepoCard from './RepoCard';
```

Remove imports no longer used: `SidebarProjectItem`, `SidebarRepoGroup`. Leave `SidebarProjectsState` and grouping utilities.

- [ ] **Step 3: Forward `additionalSessions` from `Sidebar.tsx`**

In `src/components/sidebar/view/Sidebar.tsx`, the controller already returns `additionalSessions`. Add it to the destructured returned values (around line 56) and add it to `projectListProps`:

```ts
  // line ~56 area — add additionalSessions to destructured values
  const {
    // ...existing...
    additionalSessions,
    // ...existing...
  } = useSidebarController({ /* unchanged */ });

  // line ~135-184 area — add to projectListProps
  const projectListProps: SidebarProjectListProps = {
    // ...existing fields...
    additionalSessions,
    // ...rest unchanged...
  };
```

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS. If errors mention removed component imports elsewhere, defer them — Task 8 deletes the legacy components.

- [ ] **Step 5: Run the dev server and click through**

```bash
npm run dev
```

Open http://localhost:5173 (or printed URL). Verify:
- A project with worktrees shows the RepoCard with branch chip on the header
- Clicking the header expands to show "+ New session", RECENT, and WORKTREES
- A standalone project shows just the header → "+ New session" → RECENT (no WORKTREES)

If it works, kill the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/view/subcomponents/SidebarProjectList.tsx \
        src/components/sidebar/view/Sidebar.tsx
git commit -m "feat(sidebar): render every repo via RepoCard, drop ProjectItem path"
```

---

## Task 8: Remove obsolete components

**Files:**
- Delete: `src/components/sidebar/view/subcomponents/SidebarRepoGroup.tsx`
- Delete: `src/components/sidebar/view/subcomponents/SidebarProjectItem.tsx`
- Delete: `src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx`
- Delete: `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`

- [ ] **Step 1: Verify no remaining imports**

```bash
grep -rn "SidebarRepoGroup\|SidebarProjectItem\|SidebarProjectSessions\|SidebarSessionItem" \
  /home/ash/open_source/claudecodeui/src
```

Expected: only the files themselves match. If any other file imports them, fix that file before deletion.

- [ ] **Step 2: Delete the files**

```bash
rm src/components/sidebar/view/subcomponents/SidebarRepoGroup.tsx \
   src/components/sidebar/view/subcomponents/SidebarProjectItem.tsx \
   src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx \
   src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run unit tests**

```bash
npm test
```

Expected: PASS (no test should depend on the deleted components).

- [ ] **Step 5: Commit**

```bash
git add -A src/components/sidebar/view/subcomponents/
git commit -m "refactor(sidebar): remove legacy RepoGroup/ProjectItem/ProjectSessions/SessionItem"
```

---

## Task 9: Honor explicit worktree in `handleNewSession`

**Files:**
- Modify: `src/hooks/useProjectsState.ts:429-454`

The current `handleNewSession` re-routes to the main project even when the caller explicitly passes a linked worktree. The new sidebar uses the per-worktree `+` to mean "new session in *this* worktree", so the auto-reroute must become opt-in (default: use the project the caller passed).

- [ ] **Step 1: Read the existing block**

Open `src/hooks/useProjectsState.ts` around line 429 and confirm the current `handleNewSession` matches the snippet in the spec.

- [ ] **Step 2: Replace the body**

```ts
  const handleNewSession = useCallback(
    (project: Project) => {
      // Honor whichever project the caller passed. The new sidebar uses the
      // main project for "+ New session" (top-level CTA) and a linked worktree
      // for the per-worktree "+" hover. Both should land on the project they
      // were given. Server-synthesized main projects without a `repoGroup`
      // continue to work because `project` already points at them.
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );
```

The dependency array drops `projects` (no longer used) and keeps only `isMobile` and `navigate`. The state setters (`setSelectedProject`, `setSelectedSession`, `setActiveTab`, `setSidebarOpen`) are stable `useState` setters so React doesn't require them in the array — match the existing convention in this file (look at neighboring `useCallback` blocks: they omit setters).

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Manually verify in the browser**

```bash
npm run dev
```

- Click "+ New session" at the top of a repo → routes to the main project, the new-session creation flow opens.
- Hover a linked worktree row, click the "+" that appears → routes to **that worktree**, the new-session creation flow opens against it.
- Confirm by inspecting React state or by completing the flow and checking that the new session appears under the expected branch chip.

Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProjectsState.ts
git commit -m "fix(projects): honor explicit worktree target in handleNewSession"
```

---

## Task 10: Add i18n strings

**Files:**
- Modify: `src/i18n/locales/en/sidebar.json`
- Modify: each other locale under `src/i18n/locales/*/sidebar.json` (German, Japanese, Korean, Russian, Chinese)

Add the new keys with English fallbacks. Other locales get the English string (translation can be a follow-up).

- [ ] **Step 1: Find the locale files**

```bash
ls src/i18n/locales
```

Expected: `de en ja ko ru zh-CN` (or similar).

- [ ] **Step 2: Edit `en/sidebar.json`**

Inside the existing `"projects"` object, add:

```json
"recent": "Recent",
"worktreesUpper": "Worktrees",
"newSession": "New session",
"showAll": "Show all",
"emptyWorktree": "empty · click to start",
"staleWorktree": "archived",
"sessionsShort_one": "session",
"sessionsShort_other": "sessions",
"messages": "messages"
```

Inside the existing `"time"` object (or create one if missing):

```json
"justNow": "just now",
"minutesAgo_one": "{{count}}m ago",
"minutesAgo_other": "{{count}}m ago",
"hoursAgo_one": "{{count}}h ago",
"hoursAgo_other": "{{count}}h ago",
"daysAgo_one": "{{count}}d ago",
"daysAgo_other": "{{count}}d ago"
```

Inside `"tooltips"`:

```json
"newSessionInWorktree": "New session in this worktree"
```

- [ ] **Step 3: Mirror keys to other locales**

For each non-English locale file, add the same keys with the **English** value as a placeholder. The locales test (`src/i18n/__tests__/locales.test.ts`) will likely flag missing keys; copying the English value satisfies it.

- [ ] **Step 4: Run the locale test**

```bash
npm test -- locales
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/
git commit -m "i18n: add sidebar redesign strings (en + placeholders for other locales)"
```

---

## Task 11: End-to-end browser verification

**Files:** none — this is a verification task.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open the printed URL.

- [ ] **Step 2: Verify each acceptance criterion from the spec**

Walk through the spec's acceptance criteria, ticking each:

1. **Worktree-only project gets a clickable repo header.** Identify or create a project that's worktree-only on your machine. Confirm the sidebar shows a header labeled with the repo name (not `.claude/worktrees/...`) and clicking it expands.
2. **RECENT mixes main + worktree sessions.** A project like `claudecodeui` (this repo) should show recent sessions from `feat/worktree-toggle` (main folder) interleaved with any linked-worktree sessions, sorted by recency.
3. **Click session in RECENT opens it regardless of worktree.** Click a session belonging to a linked worktree → chat pane updates to that worktree's context. Click a session in main → returns to main.
4. **Click worktree row opens latest session.** Click a non-empty linked worktree row → its most recent session loads.
5. **Empty worktree click triggers new-session flow.** If you have or can create an empty linked worktree, clicking it opens the new-session creation UI for that worktree.
6. **Hover "+" on worktree row.** Hovering reveals the `+`; clicking it opens the new-session UI explicitly targeting that worktree.
7. **Single-worktree project has no WORKTREES section.** Standalone projects (or projects with only the main checkout) show only RECENT, no WORKTREES.
8. **Repo header chip reflects current branch.** Switch the main folder's branch (use the existing UI). The header chip updates without a full reload (the existing `branch_changed` ws message + `8707776` fix should drive this).
9. **Visual hierarchy reads top-down.** Repo header → "+ New" → RECENT → WORKTREES. No deeper nesting visible.

Note any failure mode in a follow-up issue or fix inline.

- [ ] **Step 3: Run the full test suite once more**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run the typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit (if any docs/notes were updated)**

If you produced any tweaks during verification, commit them with a message like `fix(sidebar): polish from manual verification` and a description of what changed.

---

## Self-Review Checklist (run after writing the plan, fix inline)

- **Spec coverage:** Every section in the spec maps to at least one task. Repo header (T6), "+ New session" (T3, T6), RECENT (T5, T6), WORKTREES (T4, T6), single-worktree projects (T6 via empty `linkedWorktrees`), stale worktrees (T4 dormant styling), branch chips (T2), search (unchanged — no task), mobile (unchanged), worktree creation flow (T9 + relies on existing UI).
- **Placeholder scan:** Every step contains either runnable code, an exact command, or an exact bash invocation. No "TBD", "implement later", or vague "add error handling" steps.
- **Type consistency:** `getRepoSessions` returns `(SessionWithProvider & { __projectName: string })[]` everywhere. `RepoCardProps.linkedWorktrees` is `Project[]` everywhere. `WorktreeRowProps.onOpen` and `onNewSessionInWorktree` both take `Project`. `BranchChip.branchName` is `string | null | undefined` consistently.

---

## Out of scope for this plan (tracked separately)

- Per-worktree rename and delete affordances (the previous `SidebarProjectItem` had them; the redesign drops them).
- A `...` menu on the repo header (rename/delete repo, "new worktree", etc.).
- Adding React Testing Library to enable component-level TDD.
- Branch-chip palette tuning beyond the 5-color default.
- Search-mode tweaks (project search keeps current behavior).
