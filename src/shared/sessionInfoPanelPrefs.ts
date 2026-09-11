import { readUserPreference } from '@/shared/userSettings';

/**
 * The session info panel's layout preferences, stored in `auth.db` through the
 * preference store (the same route `uiPreferences` uses), so the panel opens
 * the same way on every device.
 *
 * Kept separate from the boolean `uiPreferences` blob because this one holds
 * an object (`collapsedSections`) and evolves its own shape.
 */
export type SessionInfoPanelSection =
  | 'context'
  | 'turnStats'
  | 'subagents'
  | 'tasks'
  | 'mcp'
  | 'sources';

export type SessionInfoPanelPrefs = {
  open: boolean;
  collapsedSections: Partial<Record<SessionInfoPanelSection, boolean>>;
};

const DEFAULTS: SessionInfoPanelPrefs = {
  open: false,
  collapsedSections: {},
};

const VALID_SECTIONS: ReadonlySet<string> = new Set<SessionInfoPanelSection>([
  'context',
  'turnStats',
  'subagents',
  'tasks',
  'mcp',
  'sources',
]);

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

/**
 * Reads the stored panel layout, filling defaults for anything never touched.
 * Synchronous against the localStorage mirror, like the other preferences.
 */
export const readStoredSessionInfoPanelPrefs = (): SessionInfoPanelPrefs => {
  const stored = readUserPreference<Record<string, unknown>>('sessionInfoPanel', {});

  const collapsedSource = stored.collapsedSections;
  const collapsedSections: Partial<Record<SessionInfoPanelSection, boolean>> = {};
  if (collapsedSource && typeof collapsedSource === 'object' && !Array.isArray(collapsedSource)) {
    for (const [key, value] of Object.entries(collapsedSource as Record<string, unknown>)) {
      // A section is either collapsed (present, true) or absent; a stored
      // `false` is normalized away so the shape stays canonical.
      if (VALID_SECTIONS.has(key) && parseBoolean(value, false)) {
        collapsedSections[key as SessionInfoPanelSection] = true;
      }
    }
  }

  return {
    open: parseBoolean(stored.open, DEFAULTS.open),
    collapsedSections,
  };
};

/** Immutably flips one section's collapsed flag. */
export const withSectionCollapsed = (
  prefs: SessionInfoPanelPrefs,
  section: SessionInfoPanelSection,
  collapsed: boolean,
): SessionInfoPanelPrefs => {
  if (Boolean(prefs.collapsedSections[section]) === collapsed) {
    return prefs;
  }

  const collapsedSections = { ...prefs.collapsedSections };
  if (collapsed) {
    collapsedSections[section] = true;
  } else {
    delete collapsedSections[section];
  }

  return { ...prefs, collapsedSections };
};
