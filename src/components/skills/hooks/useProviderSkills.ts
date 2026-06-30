import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type {
  ApiResponse,
  ProviderSkill,
  ProviderSkillCreatePayload,
  ProviderSkillRegistryActionResponse,
  ProviderSkillRegistryResult,
  ProviderSkillRegistrySearchResponse,
  ProviderSkillsResponse,
  SkillsProject,
  SkillsProvider,
  SkillsScope,
} from '../types';

type SkillsCacheEntry = {
  skills: ProviderSkill[];
  updatedAt: number;
};

type ProjectTarget = {
  projectId: string;
  displayName: string;
  path: string;
};

const SKILLS_CACHE_TTL_MS = 5 * 60_000;
const skillsCache = new Map<string, SkillsCacheEntry>();

const SKILL_SCOPE_ORDER: Record<SkillsScope, number> = {
  user: 0,
  plugin: 1,
  repo: 2,
  project: 3,
  admin: 4,
  system: 5,
};

const toResponseJson = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

const getApiErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  const details = record.details;
  if (typeof details === 'string' && details.trim()) {
    return details;
  }

  return fallback;
};

const isSkillsScope = (value: unknown): value is SkillsScope => (
  value === 'user'
  || value === 'project'
  || value === 'plugin'
  || value === 'repo'
  || value === 'admin'
  || value === 'system'
);

const normalizeScope = (value: unknown): SkillsScope => (
  isSkillsScope(value) ? value : 'user'
);

const createProjectTargets = (projects: SkillsProject[]): ProjectTarget[] => {
  const seenPaths = new Set<string>();

  return projects.reduce<ProjectTarget[]>((acc, project) => {
    const projectPath = project.fullPath || project.path || '';
    if (!projectPath || seenPaths.has(projectPath)) {
      return acc;
    }

    seenPaths.add(projectPath);
    acc.push({
      projectId: project.projectId,
      displayName: project.displayName || project.projectId,
      path: projectPath,
    });
    return acc;
  }, []);
};

const normalizeSkill = (
  provider: SkillsProvider,
  skill: Partial<ProviderSkill>,
  project?: ProjectTarget,
): ProviderSkill => {
  const scope = normalizeScope(skill.scope);
  const shouldAttachProject = scope === 'project' || scope === 'repo';

  return {
    provider,
    name: String(skill.name ?? ''),
    description: String(skill.description ?? ''),
    command: String(skill.command ?? ''),
    scope,
    sourcePath: String(skill.sourcePath ?? ''),
    pluginName: typeof skill.pluginName === 'string' ? skill.pluginName : undefined,
    pluginId: typeof skill.pluginId === 'string' ? skill.pluginId : undefined,
    projectDisplayName: shouldAttachProject
      ? project?.displayName ?? skill.projectDisplayName
      : skill.projectDisplayName,
    projectPath: shouldAttachProject
      ? project?.path ?? skill.projectPath
      : skill.projectPath,
  };
};

const getSkillIdentity = (skill: ProviderSkill): string => (
  [
    skill.provider,
    skill.scope,
    skill.command,
    skill.sourcePath || 'no-source-path',
    skill.projectPath || 'global',
  ].join(':')
);

const sortSkills = (skills: ProviderSkill[]): ProviderSkill[] => (
  [...skills].sort((left, right) => {
    const scopeDelta = SKILL_SCOPE_ORDER[left.scope] - SKILL_SCOPE_ORDER[right.scope];
    if (scopeDelta !== 0) {
      return scopeDelta;
    }

    const projectDelta = (left.projectDisplayName || '').localeCompare(right.projectDisplayName || '');
    if (projectDelta !== 0) {
      return projectDelta;
    }

    return left.command.localeCompare(right.command);
  })
);

const mergeSkills = (
  existingSkills: ProviderSkill[],
  incomingSkills: ProviderSkill[],
): ProviderSkill[] => {
  const skillsById = new Map<string, ProviderSkill>();
  existingSkills.forEach((skill) => {
    skillsById.set(getSkillIdentity(skill), skill);
  });
  incomingSkills.forEach((skill) => {
    skillsById.set(getSkillIdentity(skill), skill);
  });

  return sortSkills([...skillsById.values()]);
};

const fetchProviderSkills = async (
  provider: SkillsProvider,
  project?: ProjectTarget,
): Promise<ProviderSkill[]> => {
  const params = new URLSearchParams();
  if (project?.path) {
    params.set('workspacePath', project.path);
  }

  const response = await authenticatedFetch(
    `/api/providers/${provider}/skills${params.toString() ? `?${params.toString()}` : ''}`,
  );
  const data = await toResponseJson<ApiResponse<ProviderSkillsResponse>>(response);
  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, `Failed to load ${provider} skills`));
  }

  return (data.data.skills || []).map((skill) => normalizeSkill(provider, skill, project));
};

const saveProviderSkills = async (
  provider: SkillsProvider,
  payload: ProviderSkillCreatePayload,
): Promise<ProviderSkill[]> => {
  const response = await authenticatedFetch(`/api/providers/${provider}/skills`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await toResponseJson<ApiResponse<ProviderSkillsResponse>>(response);
  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to save skills'));
  }

  return (data.data.skills || []).map((skill) => normalizeSkill(provider, skill));
};

const searchProviderSkillRegistry = async (
  provider: SkillsProvider,
  query: string,
  limit = 10,
): Promise<ProviderSkillRegistryResult[]> => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  const response = await authenticatedFetch(`/api/providers/${provider}/skills/registry/search?${params.toString()}`);
  const data = await toResponseJson<ApiResponse<ProviderSkillRegistrySearchResponse>>(response);
  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to search skill registry'));
  }
  return data.data.results || [];
};

const runProviderSkillRegistryAction = async (
  provider: SkillsProvider,
  action: 'install' | 'check' | 'update' | 'audit',
  payload?: Record<string, unknown>,
): Promise<ProviderSkillRegistryActionResponse['result']> => {
  const response = await authenticatedFetch(`/api/providers/${provider}/skills/registry/${action}`, {
    method: 'POST',
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await toResponseJson<ApiResponse<ProviderSkillRegistryActionResponse>>(response);
  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, `Failed to run ${action}`));
  }
  return data.data.result;
};

const uninstallProviderSkillRegistrySkill = async (
  provider: SkillsProvider,
  name: string,
): Promise<ProviderSkillRegistryActionResponse['result']> => {
  const response = await authenticatedFetch(`/api/providers/${provider}/skills/registry/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  const data = await toResponseJson<ApiResponse<ProviderSkillRegistryActionResponse>>(response);
  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to uninstall skill'));
  }
  return data.data.result;
};

const getCacheKey = (provider: SkillsProvider, projects: ProjectTarget[]): string => {
  const projectKey = projects.map((project) => project.path).sort().join('|');
  return `${provider}:${projectKey}`;
};

const clearProviderSkillCache = (provider: SkillsProvider): void => {
  for (const cacheKey of [...skillsCache.keys()]) {
    if (cacheKey.startsWith(`${provider}:`)) {
      skillsCache.delete(cacheKey);
    }
  }
};

type UseProviderSkillsArgs = {
  selectedProvider: SkillsProvider;
  currentProjects: SkillsProject[];
};

export function useProviderSkills({ selectedProvider, currentProjects }: UseProviderSkillsArgs) {
  const [skills, setSkills] = useState<ProviderSkill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingProjectScopes, setIsLoadingProjectScopes] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const [registryResults, setRegistryResults] = useState<ProviderSkillRegistryResult[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [registryStatus, setRegistryStatus] = useState<string | null>(null);
  const [registryBusyKey, setRegistryBusyKey] = useState<string | null>(null);
  const activeLoadIdRef = useRef(0);

  const projectTargets = useMemo(() => createProjectTargets(currentProjects), [currentProjects]);
  const cacheKey = useMemo(() => getCacheKey(selectedProvider, projectTargets), [projectTargets, selectedProvider]);

  const refreshSkills = useCallback(async (options: { force?: boolean } = {}) => {
    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;

    const cachedEntry = skillsCache.get(cacheKey);
    const canUseCache = !options.force && cachedEntry && Date.now() - cachedEntry.updatedAt < SKILLS_CACHE_TTL_MS;
    if (canUseCache) {
      setSkills(cachedEntry.skills);
      setIsLoading(false);
      setIsLoadingProjectScopes(false);
      setLoadError(null);
      return;
    }

    if (cachedEntry && !options.force) {
      setSkills(cachedEntry.skills);
    } else {
      setSkills([]);
    }

    setIsLoading(!cachedEntry);
    setIsLoadingProjectScopes(false);
    setLoadError(null);

    // Build the authoritative list from the fresh fetches only. The cache still
    // feeds instant display above, but seeding the merge from it would let
    // skills deleted out-of-band survive the union and never get pruned.
    let nextSkills: ProviderSkill[] = [];
    let firstError: string | null = null;

    try {
      const globalSkills = await fetchProviderSkills(selectedProvider);
      if (activeLoadIdRef.current !== loadId) {
        return;
      }

      nextSkills = mergeSkills(nextSkills, globalSkills);
      setSkills(nextSkills);
    } catch (error) {
      firstError = error instanceof Error ? error.message : 'Failed to load skills';
    }

    if (activeLoadIdRef.current !== loadId) {
      return;
    }

    setIsLoading(false);

    if (projectTargets.length === 0) {
      const finalSkills = sortSkills(nextSkills);
      skillsCache.set(cacheKey, { skills: finalSkills, updatedAt: Date.now() });
      setSkills(finalSkills);
      setLoadError(firstError);
      return;
    }

    setIsLoadingProjectScopes(true);

    await Promise.all(projectTargets.map(async (project) => {
      try {
        const projectSkills = await fetchProviderSkills(selectedProvider, project);
        if (activeLoadIdRef.current !== loadId) {
          return;
        }

        nextSkills = mergeSkills(nextSkills, projectSkills);
        setSkills(nextSkills);
      } catch (error) {
        firstError = firstError || (error instanceof Error ? error.message : 'Failed to load skills');
      }
    }));

    if (activeLoadIdRef.current !== loadId) {
      return;
    }

    const finalSkills = sortSkills(nextSkills);
    skillsCache.set(cacheKey, { skills: finalSkills, updatedAt: Date.now() });
    setSkills(finalSkills);
    setLoadError(firstError);
    setIsLoadingProjectScopes(false);
  }, [cacheKey, projectTargets, selectedProvider]);

  const addSkills = useCallback(async (payload: ProviderSkillCreatePayload) => {
    try {
      const createdSkills = await saveProviderSkills(selectedProvider, payload);
      clearProviderSkillCache(selectedProvider);
      await refreshSkills({ force: true });
      setSaveStatus('success');
      return createdSkills;
    } catch (error) {
      setSaveStatus('error');
      throw error;
    }
  }, [refreshSkills, selectedProvider]);

  const searchRegistry = useCallback(async (query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setRegistryResults([]);
      setRegistryError(null);
      return;
    }

    setRegistryBusyKey('search');
    setRegistryError(null);
    setRegistryStatus(null);
    try {
      setRegistryResults(await searchProviderSkillRegistry(selectedProvider, normalizedQuery, 12));
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : 'Failed to search skill registry');
    } finally {
      setRegistryBusyKey((current) => (current === 'search' ? null : current));
    }
  }, [selectedProvider]);

  const installRegistrySkill = useCallback(async (identifier: string) => {
    setRegistryBusyKey(`install:${identifier}`);
    setRegistryError(null);
    setRegistryStatus(null);
    try {
      await runProviderSkillRegistryAction(selectedProvider, 'install', { identifier });
      clearProviderSkillCache(selectedProvider);
      await refreshSkills({ force: true });
      setRegistryStatus('Skill installed.');
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : 'Failed to install skill');
    } finally {
      setRegistryBusyKey((current) => (current === `install:${identifier}` ? null : current));
    }
  }, [refreshSkills, selectedProvider]);

  const uninstallRegistrySkill = useCallback(async (name: string) => {
    setRegistryBusyKey(`uninstall:${name}`);
    setRegistryError(null);
    setRegistryStatus(null);
    try {
      await uninstallProviderSkillRegistrySkill(selectedProvider, name);
      clearProviderSkillCache(selectedProvider);
      await refreshSkills({ force: true });
      setRegistryStatus('Skill uninstalled.');
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : 'Failed to uninstall skill');
    } finally {
      setRegistryBusyKey((current) => (current === `uninstall:${name}` ? null : current));
    }
  }, [refreshSkills, selectedProvider]);

  const runRegistryMaintenance = useCallback(async (action: 'check' | 'update' | 'audit') => {
    setRegistryBusyKey(action);
    setRegistryError(null);
    setRegistryStatus(null);
    try {
      const result = await runProviderSkillRegistryAction(selectedProvider, action);
      if (action === 'update' || action === 'audit') {
        clearProviderSkillCache(selectedProvider);
        await refreshSkills({ force: true });
      }
      setRegistryStatus((result.stdout || result.stderr || `${action} completed.`).trim());
    } catch (error) {
      setRegistryError(error instanceof Error ? error.message : `Failed to run ${action}`);
    } finally {
      setRegistryBusyKey((current) => (current === action ? null : current));
    }
  }, [refreshSkills, selectedProvider]);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  useEffect(() => {
    setSaveStatus(null);
    setRegistryResults([]);
    setRegistryError(null);
    setRegistryStatus(null);
    setRegistryBusyKey(null);
  }, [selectedProvider]);

  useEffect(() => {
    if (saveStatus === null) {
      return;
    }

    const timer = window.setTimeout(() => setSaveStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  return {
    skills,
    isLoading,
    isLoadingProjectScopes,
    loadError,
    saveStatus,
    registryResults,
    registryError,
    registryStatus,
    registryBusyKey,
    addSkills,
    refreshSkills,
    searchRegistry,
    installRegistrySkill,
    uninstallRegistrySkill,
    runRegistryMaintenance,
  };
}
