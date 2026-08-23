/**
 * API Documentation System
 * Provides OpenAPI 3.0 specification, Swagger UI, and formatted HTML documentation
 */

const API_ENDPOINTS = [
  // Authentication Endpoints
  {
    method: 'POST',
    path: '/api/auth/login',
    name: 'Login',
    description: 'Authenticate user and receive JWT token',
    category: 'Auth',
    requiresAuth: false,
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    name: 'Logout',
    description: 'Logout user and invalidate token',
    category: 'Auth',
    requiresAuth: true,
  },

  // Projects Endpoints
  {
    method: 'GET',
    path: '/api/projects',
    name: 'List Projects',
    description: 'Get list of all projects',
    category: 'Projects',
    requiresAuth: true,
  },
  {
    method: 'POST',
    path: '/api/projects/create-project',
    name: 'Create Project',
    description: 'Create a new project at the specified directory path',
    category: 'Projects',
    requiresAuth: true,
  },

  // Settings Endpoints
  {
    method: 'GET',
    path: '/api/settings',
    name: 'Get Settings',
    description: 'Get user settings and preferences',
    category: 'Settings',
    requiresAuth: true,
  },
  {
    method: 'PUT',
    path: '/api/settings',
    name: 'Update Settings',
    description: 'Update user settings',
    category: 'Settings',
    requiresAuth: true,
  },

  // Git Endpoints
  {
    method: 'GET',
    path: '/api/git/status',
    name: 'Get Git Status',
    description: 'Get git status of current project',
    category: 'Git',
    requiresAuth: true,
  },

  // Agent/Chat Endpoints
  {
    method: 'POST',
    path: '/api/agent',
    name: 'Send Agent Message',
    description: 'Send a request to the AI agent for code assistance',
    category: 'Chat',
    requiresAuth: true,
  },

  // System Endpoints
  {
    method: 'GET',
    path: '/api/health',
    name: 'Health Check',
    description: 'Check if API is running and healthy',
    category: 'System',
    requiresAuth: false,
  },
  {
    method: 'GET',
    path: '/api/docs/openapi.json',
    name: 'OpenAPI Specification',
    description: 'Get OpenAPI 3.0 specification',
    category: 'System',
    requiresAuth: false,
  },
  {
    method: 'GET',
    path: '/api/docs/swagger',
    name: 'Swagger UI',
    description: 'Interactive API documentation',
    category: 'System',
    requiresAuth: false,
  },
  {
    method: 'GET',
    path: '/api/docs',
    name: 'API Documentation',
    description: 'Formatted HTML API documentation',
    category: 'System',
    requiresAuth: false,
  },
];

/**
 * Generate OpenAPI 3.0 specification from endpoint definitions
 */
export function generateOpenAPISpec(baseUrl: string = ''): Record<string, unknown> {
  const paths: Record<string, any> = {};

  API_ENDPOINTS.forEach((endpoint) => {
    if (!paths[endpoint.path]) {
      paths[endpoint.path] = {};
    }

    const method = endpoint.method.toLowerCase();
    paths[endpoint.path][method] = {
      summary: endpoint.name,
      description: endpoint.description,
      tags: [endpoint.category],
      security: endpoint.requiresAuth ? [{ BearerAuth: [] }] : [],
      responses: {
        200: {
          description: 'Success',
        },
        401: {
          description: 'Unauthorized',
        },
        500: {
          description: 'Server error',
        },
      },
    };
  });

  return {
    openapi: '3.0.0',
    info: {
      title: 'CloudCLI API',
      version: '1.37.2',
      description:
        'RESTful API for CloudCLI - Web-based UI for Claude Code CLI. Use Claude Code, OpenCode, Cursor CLI, and Codex on mobile and web.',
      contact: {
        name: 'CloudCLI Contributors',
        url: 'https://github.com/siteboon/claudecodeui',
      },
    },
    servers: [
      {
        url: '',
        description: 'Current instance (relative URL)',
      },
    ],
    paths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  };
}

/**
 * Format endpoints for HTML documentation
 */
export function formatEndpointsForHTML(): string {
  const grouped: Record<string, any[]> = {};

  API_ENDPOINTS.forEach((endpoint) => {
    if (!grouped[endpoint.category]) {
      grouped[endpoint.category] = [];
    }
    grouped[endpoint.category].push(endpoint);
  });

  let html = '<div class="endpoints">';

  Object.entries(grouped).forEach(([category, endpoints]) => {
    html += `<section class="category">
      <h2>${category}</h2>`;

    endpoints.forEach((ep) => {
      const methodClass = ep.method.toLowerCase();
      html += `
      <div class="endpoint">
        <div class="header">
          <span class="method ${methodClass}">${ep.method}</span>
          <span class="path">${ep.path}</span>
          ${ep.requiresAuth ? '<span class="auth-badge">Auth Required</span>' : ''}
        </div>
        <p class="description">${ep.description}</p>
      </div>`;
    });

    html += '</section>';
  });

  html += '</div>';
  return html;
}

export { API_ENDPOINTS };
