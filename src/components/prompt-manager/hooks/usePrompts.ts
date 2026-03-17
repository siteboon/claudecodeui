import { useState, useCallback } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import type { Prompt, ActiveRole, PromptsListResponse, PromptLoadResponse } from '../types/types';

export function usePrompts(projectId: string | null) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<ActiveRole | null>(null);

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

  const applyRole = useCallback(async (prompt: Prompt) => {
    try {
      const content = await loadPromptContent(prompt);
      setActiveRole({
        name: prompt.name,
        content,
        icon: prompt.icon
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply role');
    }
  }, [loadPromptContent]);

  const clearRole = useCallback(() => {
    setActiveRole(null);
  }, []);

  const insertTemplate = useCallback(async (prompt: Prompt): Promise<string> => {
    return await loadPromptContent(prompt);
  }, [loadPromptContent]);

  return {
    prompts,
    loading,
    error,
    activeRole,
    loadPrompts,
    applyRole,
    clearRole,
    insertTemplate
  };
}
