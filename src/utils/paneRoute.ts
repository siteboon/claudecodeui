// URL encoding / decoding for multi-session pane layout.
//
// Shape:  /session/<paneIds[0]>?panes=<id1>,<id2>&focus=<N>
//
// Invariants:
//   - The path ALWAYS holds paneIds[0] — the stable anchor. Focus changes
//     never move panes around; they only toggle the `focus` query param.
//     Bookmarks / service-worker URLs stay valid when focus changes.
//   - `panes=` contains paneIds[1..N] in order (empty / omitted when single pane).
//   - `focus=<N>` is the 0-based index into paneIds. Omitted when 0 for
//     cleanliness; single-pane URLs never include it.
//   - Single-session URL `/session/<id>` (no query) is the degenerate case
//     and round-trips as { paneIds: [id], focusIndex: 0 }.
//   - Hard cap of MAX_PANES (6); over-cap on parse drops trailing IDs and warns,
//     over-cap on build clamps silently (UI callers gate at the input layer).
//   - Empty strings and exact duplicates in the comma list are dropped.
//   - focusIndex out-of-bounds clamps to 0.

export const MAX_PANES = 6;

export interface ParsedPaneRoute {
  paneIds: string[];
  focusIndex: number;
  clamped: boolean;
}

export interface BuiltPaneRoute {
  path: string;
  search: string;
}

function dedupeInOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parsePaneRoute(
  pathSessionId: string | null | undefined,
  search: string | URLSearchParams,
): ParsedPaneRoute {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;

  const extraRaw = params.get('panes') ?? '';
  const extra = extraRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const combined = pathSessionId ? [pathSessionId, ...extra] : extra;
  const deduped = dedupeInOrder(combined);

  const clamped = deduped.length > MAX_PANES;
  const paneIds = clamped ? deduped.slice(0, MAX_PANES) : deduped;

  if (clamped && typeof console !== 'undefined') {
    console.warn(
      `[paneRoute] URL declared ${deduped.length} panes; clamped to max ${MAX_PANES}. ` +
        `Dropped: ${deduped.slice(MAX_PANES).join(', ')}`,
    );
  }

  const focusRaw = params.get('focus');
  let focusIndex = 0;
  if (focusRaw !== null) {
    const parsed = Number.parseInt(focusRaw, 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed < paneIds.length) {
      focusIndex = parsed;
    }
  }

  return { paneIds, focusIndex, clamped };
}

export function buildPaneRoute(paneIds: string[], focusIndex: number): BuiltPaneRoute {
  const deduped = dedupeInOrder(paneIds);
  const clamped = deduped.slice(0, MAX_PANES);

  if (clamped.length === 0) {
    return { path: '/', search: '' };
  }

  const anchor = clamped[0];
  const rest = clamped.slice(1);
  const path = `/session/${anchor}`;

  const safeFocus =
    Number.isFinite(focusIndex) && focusIndex >= 0 && focusIndex < clamped.length ? focusIndex : 0;

  if (rest.length === 0 && safeFocus === 0) {
    // Single-session URL — clean bookmark shape.
    return { path, search: '' };
  }

  const params = new URLSearchParams();
  if (rest.length > 0) params.set('panes', rest.join(','));
  if (safeFocus !== 0) params.set('focus', String(safeFocus));
  const search = params.toString();
  return { path, search: search ? `?${search}` : '' };
}

/**
 * Decide whether a navigation between two pane states should be a history
 * push or a replace. Focus-only changes (same ordered pane list, different
 * focused pane) are replace; any change to the pane set itself is push.
 *
 * A null `prev` (first navigation into multi-pane or deep link) is push.
 */
export function pickNavigationMode(
  prev: Pick<ParsedPaneRoute, 'paneIds' | 'focusIndex'> | null,
  next: Pick<ParsedPaneRoute, 'paneIds' | 'focusIndex'>,
): 'push' | 'replace' {
  if (!prev) return 'push';
  if (prev.paneIds.length !== next.paneIds.length) return 'push';
  for (let i = 0; i < prev.paneIds.length; i += 1) {
    if (prev.paneIds[i] !== next.paneIds[i]) return 'push';
  }
  // Same ordered pane set; only focus could differ.
  return 'replace';
}

/**
 * Helper that produces both the navigation target and the mode. UI callers
 * thread the result into `navigate(path + search, { replace })`.
 */
export interface NavigationTarget extends BuiltPaneRoute {
  replace: boolean;
}

export function navigationTarget(
  prev: Pick<ParsedPaneRoute, 'paneIds' | 'focusIndex'> | null,
  nextPaneIds: string[],
  nextFocusIndex: number,
): NavigationTarget {
  const built = buildPaneRoute(nextPaneIds, nextFocusIndex);
  const mode = pickNavigationMode(prev, { paneIds: nextPaneIds, focusIndex: nextFocusIndex });
  return { ...built, replace: mode === 'replace' };
}
