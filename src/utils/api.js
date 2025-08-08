// Utility function for authenticated API calls
export const authenticatedFetch = (url, options = {}) => {
  const token = localStorage.getItem('auth-token');
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }
  
  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
};

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username, password) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username, password) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },
  
  // Protected endpoints
  config: () => authenticatedFetch('/api/config'),
  projects: () => authenticatedFetch('/api/projects'),
  sessions: (projectName, limit = 5, offset = 0) => 
    authenticatedFetch(`/api/projects/${projectName}/sessions?limit=${limit}&offset=${offset}`),
  sessionMessages: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}/messages`),
  renameProject: (projectName, displayName) =>
    authenticatedFetch(`/api/projects/${projectName}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  deleteSession: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteProject: (projectName) =>
    authenticatedFetch(`/api/projects/${projectName}`, {
      method: 'DELETE',
    }),
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  readFile: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`),
  saveFile: (projectName, filePath, content) =>
    authenticatedFetch(`/api/projects/${projectName}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  getFiles: (projectName) =>
    authenticatedFetch(`/api/projects/${projectName}/files`),
  transcribe: (formData) =>
    authenticatedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  // PRETASK management endpoints
  pretasks: {
    // Get all pretasks for a session
    list: (sessionId) =>
      authenticatedFetch(`/api/sessions/${sessionId}/pretasks`),
    
    // Add a new pretask
    add: (sessionId, content, projectName) =>
      authenticatedFetch(`/api/sessions/${sessionId}/pretasks`, {
        method: 'POST',
        body: JSON.stringify({ 
          content, 
          project_name: projectName 
        }),
      }),
    
    // Delete a pretask
    delete: (sessionId, pretaskId) =>
      authenticatedFetch(`/api/sessions/${sessionId}/pretasks/${pretaskId}`, {
        method: 'DELETE',
      }),
    
    // Update pretask order
    updateOrder: (sessionId, pretasks) =>
      authenticatedFetch(`/api/sessions/${sessionId}/pretasks/order`, {
        method: 'PUT',
        body: JSON.stringify({ pretasks }),
      }),
    
    // Toggle auto-execute setting
    toggleAutoExecute: (sessionId, autoExecute) =>
      authenticatedFetch(`/api/sessions/${sessionId}/auto-execute`, {
        method: 'PUT',
        body: JSON.stringify({ auto_execute: autoExecute }),
      }),
    
    // Get next pretask (internal use)
    getNext: (sessionId) =>
      authenticatedFetch(`/api/sessions/${sessionId}/pretasks/next`),
    
    // Mark pretask as completed (internal use)
    complete: (sessionId, pretaskId) =>
      authenticatedFetch(`/api/sessions/${sessionId}/pretasks/${pretaskId}/complete`, {
        method: 'PUT',
      }),

    // Manual execution - Start executing PRETASKs for a session
    execute: (sessionId, projectPath, cwd) =>
      authenticatedFetch(`/api/sessions/${sessionId}/pretasks/execute`, {
        method: 'POST',
        body: JSON.stringify({ 
          projectPath: projectPath,
          cwd: cwd 
        }),
      }),
  },
};