// Get the base path from Vite's import.meta.env
const BASE_PATH = import.meta.env.BASE_URL || '';

// Utility function to create API URLs with base path
export const createApiUrl = (path) => {
  // Remove leading slash from path if present to avoid double slashes
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  // Ensure BASE_PATH ends with slash for proper concatenation
  const basePath = BASE_PATH.endsWith('/') ? BASE_PATH : BASE_PATH + '/';
  return basePath + cleanPath;
};

// Utility function for fetch with base path support
export const fetchWithBasePath = (url, options = {}) => {
  return fetch(createApiUrl(url), options);
};

// Utility function for authenticated fetch with base path support
export const authenticatedFetchWithBasePath = (url, options = {}) => {
  const token = localStorage.getItem('auth-token');
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }
  
  return fetch(createApiUrl(url), {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
};
