import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { GitBranchDiffFile, GitBranchDiffResponse, GitDiffMap, GitFileDiffResponse, GitStatusResponse } from '@/shared/types';
import { pickDefaultCompareBase } from '@/modules/git-panel/utils/gitPanelUtils';

type UseBranchCompareOptions = {
  projectId: string | null;
  currentBranch: string;
  localBranches: string[];
  remoteRefs: string[];
  /** Only observed for identity: a new status object means the working tree changed, so the comparison is re-run. */
  gitStatus: GitStatusResponse | null;
};

type BranchCompareError = {
  /** Stable server code such as `GIT_NO_MERGE_BASE`, when the failure is a known one. */
  code: string | null;
  message: string;
};

type BranchCompare = {
  base: string;
  setBase: (base: string) => void;
  files: GitBranchDiffFile[];
  mergeBase: string | null;
  isLoading: boolean;
  error: BranchCompareError | null;
  fileDiffs: GitDiffMap;
  /** Why a file's diff could not be loaded, keyed by path; absent while loading or once loaded. */
  fileDiffErrors: Record<string, string>;
  loadFileDiff: (file: GitBranchDiffFile) => Promise<void>;
  refresh: () => void;
};

// Per-file diff outcomes, tagged with the (project, base) pair they belong to
// so another base never shows stale text. A path is in at most one map.
type FileDiffState = {
  requestKey: string;
  diffs: GitDiffMap;
  errors: Record<string, string>;
};

// Outcome of the latest list request, tagged with the (project, base) pair it
// answers so a pair change can hide it by derivation instead of a reset.
type CompareResult = {
  requestKey: string;
  files: GitBranchDiffFile[];
  mergeBase: string | null;
  error: BranchCompareError | null;
};

// Identifies one list request: the pair plus the triggers (manual refresh,
// working-tree change) that re-run it for the same pair.
type CompareRequest = {
  requestKey: string;
  refreshToken: number;
  gitStatus: GitStatusResponse | null;
};

// Stable empty values so consumers' memoized callbacks keyed on them do not
// churn while a pair has no data yet.
const EMPTY_FILES: GitBranchDiffFile[] = [];
const EMPTY_DIFFS: GitDiffMap = {};
const EMPTY_ERRORS: Record<string, string> = {};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function omitPath(record: Record<string, string>, filePath: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([path]) => path !== filePath));
}

function isSameRequest(left: CompareRequest | null, right: CompareRequest): boolean {
  return left !== null
    && left.requestKey === right.requestKey
    && left.refreshToken === right.refreshToken
    && left.gitStatus === right.gitStatus;
}

/**
 * Used by CompareView to own the Compare tab's data: which base branch is
 * selected, the files the working copy changed relative to its merge base, and
 * lazily loaded per-file diffs. Every request is tied to the (project, base)
 * it was issued for and dropped if either changes before it resolves.
 */
export function useBranchCompare({
  projectId,
  currentBranch,
  localBranches,
  remoteRefs,
  gitStatus,
}: UseBranchCompareOptions): BranchCompare {
  // The base the user explicitly chose; null means "use the computed default"
  // so the default can still settle once the branch lists finish loading.
  const [baseOverride, setBaseOverride] = useState<string | null>(null);
  // Latest list outcome (files, merge base or error) — the tab's content.
  const [result, setResult] = useState<CompareResult | null>(null);
  // Unified diff text (or the load failure) per path, filled on demand when a
  // row is expanded; the row shows a spinner while its path is in neither map.
  const [fileDiffState, setFileDiffState] = useState<FileDiffState>({
    requestKey: '',
    diffs: {},
    errors: {},
  });
  // The request that most recently finished; `isLoading` is derived by
  // comparing it with the request the current inputs describe.
  const [settledRequest, setSettledRequest] = useState<CompareRequest | null>(null);
  // Bumped by refresh() to re-run the list request without changing its inputs.
  const [refreshToken, setRefreshToken] = useState(0);

  const defaultBase = useMemo(
    () => pickDefaultCompareBase(localBranches, remoteRefs, currentBranch),
    [currentBranch, localBranches, remoteRefs],
  );
  // An override only counts while the branch still exists; once it is deleted
  // or pruned the selector falls back to the default instead of pointing at a
  // ref that every refresh would fail on.
  const isOverrideAvailable = baseOverride !== null
    && (localBranches.includes(baseOverride) || remoteRefs.includes(baseOverride));
  const base = isOverrideAvailable ? baseOverride : defaultBase;
  const requestKey = `${projectId ?? ''}\0${base}`;
  const hasRequest = Boolean(projectId && base);

  // Mirrors the latest request key for the async paths (file diffs, late
  // list responses) so they can tell whether they are still relevant.
  const requestKeyRef = useRef(requestKey);
  // Paths whose diff was requested (loaded or failed), read by the list effect
  // when it decides which open diffs to reload without depending on
  // `fileDiffState` itself.
  const requestedDiffPathsRef = useRef<string[]>([]);
  // Aborts user-triggered diff loads for a pair once the pair changes or the
  // tab closes; the list effect's own controller only covers its reloads.
  const fileDiffControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    requestKeyRef.current = requestKey;
    const controller = new AbortController();
    fileDiffControllerRef.current = controller;
    return () => {
      controller.abort();
    };
  }, [requestKey]);

  useEffect(() => {
    requestedDiffPathsRef.current = fileDiffState.requestKey === requestKey
      ? [...Object.keys(fileDiffState.diffs), ...Object.keys(fileDiffState.errors)]
      : [];
  }, [fileDiffState, requestKey]);

  const fetchFileDiff = useCallback(
    async (file: GitBranchDiffFile, signal?: AbortSignal) => {
      if (!projectId || !base) {
        return;
      }
      const fileRequestKey = requestKey;
      const filePath = file.path;

      // A retry after a failure shows the spinner again instead of the old error.
      setFileDiffState((previous) => (
        previous.requestKey === fileRequestKey && filePath in previous.errors
          ? { ...previous, errors: omitPath(previous.errors, filePath) }
          : previous
      ));

      const recordOutcome = (outcome: { diff: string } | { error: string }) => {
        setFileDiffState((previous) => {
          const current = previous.requestKey === fileRequestKey ? previous : { diffs: {}, errors: {} };
          return 'diff' in outcome
            ? { requestKey: fileRequestKey, diffs: { ...current.diffs, [filePath]: outcome.diff }, errors: omitPath(current.errors, filePath) }
            : { requestKey: fileRequestKey, diffs: omitPath(current.diffs, filePath), errors: { ...current.errors, [filePath]: outcome.error } };
        });
      };

      try {
        const response = await api.git.branchDiffFile(projectId, base, filePath, file.oldPath, { signal });
        const data = (await response.json()) as GitFileDiffResponse;

        if (signal?.aborted || requestKeyRef.current !== fileRequestKey) {
          return;
        }

        if (data.error) {
          console.error('Error fetching branch diff for file:', data.error);
          recordOutcome({ error: data.details || data.error });
          return;
        }

        recordOutcome({ diff: data.diff ?? '' });
      } catch (fetchError) {
        if (signal?.aborted || isAbortError(fetchError) || requestKeyRef.current !== fileRequestKey) {
          return;
        }
        console.error('Error fetching branch diff for file:', fetchError);
        recordOutcome({ error: String(fetchError) });
      }
    },
    [base, projectId, requestKey],
  );

  const loadFileDiff = useCallback(
    (file: GitBranchDiffFile) => fetchFileDiff(file, fileDiffControllerRef.current?.signal),
    [fetchFileDiff],
  );

  useEffect(() => {
    if (!hasRequest || !projectId) {
      return;
    }

    const request: CompareRequest = { requestKey, refreshToken, gitStatus };
    const controller = new AbortController();
    const { signal } = controller;
    const previouslyRequestedPaths = new Set(requestedDiffPathsRef.current);

    const fetchList = async () => {
      try {
        const response = await api.git.branchDiff(projectId, base, { signal });
        const data = (await response.json()) as GitBranchDiffResponse;

        if (signal.aborted || requestKeyRef.current !== requestKey) {
          return;
        }

        if (data.error || !data.files) {
          setResult({
            requestKey,
            files: [],
            mergeBase: null,
            error: { code: data.code ?? null, message: data.details || data.error || 'Git operation failed' },
          });
          setFileDiffState({ requestKey, diffs: {}, errors: {} });
          return;
        }

        setResult({ requestKey, files: data.files, mergeBase: data.mergeBase ?? null, error: null });

        // Drop diffs of files that no longer differ and refresh the rest in
        // place so expanded rows never collapse during a refresh.
        const currentPaths = new Set(data.files.map((file) => file.path));
        const keepCurrent = (record: Record<string, string>) => Object.fromEntries(
          Object.entries(record).filter(([path]) => currentPaths.has(path)),
        );
        setFileDiffState((previous) => (previous.requestKey === requestKey
          ? { requestKey, diffs: keepCurrent(previous.diffs), errors: keepCurrent(previous.errors) }
          : { requestKey, diffs: {}, errors: {} }));
        data.files
          .filter((file) => previouslyRequestedPaths.has(file.path))
          .forEach((file) => {
            void fetchFileDiff(file, signal);
          });
      } catch (fetchError) {
        if (signal.aborted || isAbortError(fetchError) || requestKeyRef.current !== requestKey) {
          return;
        }
        console.error('Error fetching branch diff:', fetchError);
        setResult({ requestKey, files: [], mergeBase: null, error: { code: null, message: String(fetchError) } });
      } finally {
        if (!signal.aborted && requestKeyRef.current === requestKey) {
          setSettledRequest(request);
        }
      }
    };

    void fetchList();

    return () => {
      controller.abort();
    };
  }, [base, fetchFileDiff, gitStatus, hasRequest, projectId, refreshToken, requestKey]);

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  // Everything below is derived from the tagged state so a base or project
  // change hides the previous pair's data on the very next render.
  const currentResult = result?.requestKey === requestKey ? result : null;
  const isLoading = hasRequest && !isSameRequest(settledRequest, { requestKey, refreshToken, gitStatus });

  return {
    base,
    setBase: setBaseOverride,
    files: currentResult?.files ?? EMPTY_FILES,
    mergeBase: currentResult?.mergeBase ?? null,
    isLoading,
    error: currentResult?.error ?? null,
    fileDiffs: fileDiffState.requestKey === requestKey ? fileDiffState.diffs : EMPTY_DIFFS,
    fileDiffErrors: fileDiffState.requestKey === requestKey ? fileDiffState.errors : EMPTY_ERRORS,
    loadFileDiff,
    refresh,
  };
}
