/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = import.meta.env.VITE_IS_PLATFORM === 'true';

/**
 * For empty shell instances where no project is provided, 
 * we use a default project object to ensure the shell can still function. 
 * This prevents errors related to missing project data.
 */
export const DEFAULT_PROJECT_FOR_EMPTY_SHELL = {
  name: 'default',
  displayName: 'default',
  fullPath: IS_PLATFORM ? '/workspace' : '',
  path: IS_PLATFORM ? '/workspace' : '',
};