import { useState, useCallback, useEffect } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type { Prompt, ActiveRole, ActiveRoleWithPriority, PromptsListResponse, PromptLoadResponse } from '../types/types';

const ACTIVE_ROLES_STORAGE_KEY = 'prompt-manager-active-roles';

export function usePrompts(projectId: string | null) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRoles, setActiveRoles] = useState<ActiveRoleWithPriority[]>([]);

  // Initialize activeRoles from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ACTIVE_ROLES_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setActiveRoles(parsed);
      }
    } catch (err) {
      console.error('[usePrompts] Failed to load active roles from localStorage:', err);
    }
  }, []);

  // Save activeRoles to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_ROLES_STORAGE_KEY, JSON.stringify(activeRoles));
    } catch (err) {
      console.error('[usePrompts] Failed to save active roles to localStorage:', err);
    }
  }, [activeRoles]);

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('[usePrompts] Loading prompts, projectId:', projectId);
      const response = await authenticatedFetch('/api/prompts/list', {
        method: 'POST',
        body: JSON.stringify({ projectId })
      });

      console.log('[usePrompts] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[usePrompts] Failed to load prompts:', errorText);
        throw new Error('Failed to load prompts');
      }

      const data: PromptsListResponse = await response.json();
      console.log('[usePrompts] Loaded prompts:', data);
      console.log('[usePrompts] Total prompts:', data.prompts.length);
      setPrompts(data.prompts);
    } catch (err) {
      console.error('[usePrompts] Error loading prompts:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadPromptContent = useCallback(async (prompt: Prompt): Promise<string> => {
    const response = await authenticatedFetch('/api/prompts/load', {
      method: 'POST',
      body: JSON.stringify({
        promptPath: prompt.path,
        projectId
      })
    });

    if (!response.ok) {
      throw new Error('Failed to load prompt content');
    }

    const data: PromptLoadResponse = await response.json();
    return data.content;
  }, [projectId]);

  const toggleRole = useCallback(async (prompt: Prompt): Promise<boolean> => {
    try {
      // Check if role already exists
      const existingIndex = activeRoles.findIndex(role => role.path === prompt.path);

      if (existingIndex !== -1) {
        // Role exists, remove it
        setActiveRoles(roles => {
          const filtered = roles.filter(role => role.path !== prompt.path);
          // Recalculate priorities
          return filtered.map((role, index) => ({
            ...role,
            priority: index
          }));
        });
        return false; // Role was removed
      } else {
        // Role doesn't exist, check limit
        if (activeRoles.length >= 5) {
          setError('Maximum 5 roles can be active at once');
          return false;
        }

        // Load content and add role
        const content = await loadPromptContent(prompt);
        const newRole: ActiveRoleWithPriority = {
          name: prompt.name,
          content,
          icon: prompt.icon,
          path: prompt.path,
          priority: activeRoles.length
        };
        setActiveRoles([...activeRoles, newRole]);
        return true; // Role was added
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle role');
      return false;
    }
  }, [loadPromptContent, activeRoles]);

  const applyRole = useCallback(async (prompt: Prompt) => {
    try {
      const content = await loadPromptContent(prompt);

      // Check if role already exists
      const existingIndex = activeRoles.findIndex(role => role.path === prompt.path);

      if (existingIndex === -1) {
        // Add new role with priority based on current length
        const newRole: ActiveRoleWithPriority = {
          name: prompt.name,
          content,
          icon: prompt.icon,
          path: prompt.path,
          priority: activeRoles.length
        };
        setActiveRoles([...activeRoles, newRole]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply role');
    }
  }, [loadPromptContent, activeRoles]);

  const reorderRoles = useCallback((newOrder: ActiveRoleWithPriority[]) => {
    // Update priorities based on new order
    const reordered = newOrder.map((role, index) => ({
      ...role,
      priority: index
    }));
    setActiveRoles(reordered);
  }, []);

  const removeRole = useCallback((path: string) => {
    setActiveRoles(roles => {
      const filtered = roles.filter(role => role.path !== path);
      // Recalculate priorities
      return filtered.map((role, index) => ({
        ...role,
        priority: index
      }));
    });
  }, []);

  const clearAllRoles = useCallback(() => {
    setActiveRoles([]);
  }, []);

  const getCombinedRoleContent = useCallback((): string => {
    // Sort by priority and combine content
    const sorted = [...activeRoles].sort((a, b) => a.priority - b.priority);
    return sorted.map(role => role.content).join('\n\n');
  }, [activeRoles]);

  const insertTemplate = useCallback(async (prompt: Prompt): Promise<string> => {
    return await loadPromptContent(prompt);
  }, [loadPromptContent]);

  return {
    prompts,
    loading,
    error,
    activeRoles,
    loadPrompts,
    applyRole,
    toggleRole,
    reorderRoles,
    removeRole,
    clearAllRoles,
    getCombinedRoleContent,
    insertTemplate
  };
}
