import { authenticatedFetch } from '@/utils/api';
import type { Project } from '@/types/app';

/**
 * Data Extractor layer
 * Handles fetching workspaces from the API and formatting them.
 */
export const fetchWorkspaces = async (): Promise<Project[]> => {
  try {
    const response = await authenticatedFetch('/api/projects');
    if (!response.ok) {
      throw new Error(`Failed to fetch workspaces: ${response.statusText}`);
    }
    const data = await response.json();
    
    // Normalize response formats depending on the actual backend implementation
    return data.projects || data.workspaces || data || [];
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    // Return empty array to gracefully handle failure
    return [];
  }
};
