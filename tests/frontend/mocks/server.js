// Mock Service Worker setup for API and WebSocket mocking
import { setupServer } from 'msw/node';
import { http } from 'msw';
import { jest } from '@jest/globals';

// Mock handlers for API endpoints
export const handlers = [
  // Authentication endpoints
  http.post('/api/auth/login', ({ request }) => {
    const username = request.body?.username;
    const password = request.body?.password;

    if (username === 'testuser' && password === 'password123') {
      return Response.json({
        success: true,
        user: { id: 1, username: 'testuser', email: 'test@example.com' },
        token: 'mock-jwt-token'
      });
    }

    return Response.json({
      success: false,
      error: 'Invalid credentials'
    }, { status: 401 });
  }),

  http.post('/api/auth/register', ({ request }) => {
    const { username, email, password } = request.body || {};

    if (username && email && password) {
      return Response.json({
        success: true,
        user: { id: 2, username, email },
        token: 'mock-jwt-token-new'
      }, { status: 201 });
    }

    return Response.json({
      success: false,
      error: 'Missing required fields'
    }, { status: 400 });
  }),

  http.get('/api/auth/me', ({ request }) => {
    const authHeader = request.headers.get('authorization');

    if (authHeader === 'Bearer mock-jwt-token') {
      return Response.json({
        success: true,
        user: { id: 1, username: 'testuser', email: 'test@example.com' }
      });
    }

    return Response.json({
      success: false,
      error: 'Invalid token'
    }, { status: 401 });
  }),

  // Projects endpoints
  http.get('/api/projects', () => {
    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        projects: [
          {
            id: 1,
            name: 'Test Project',
            path: '/home/user/test-project',
            description: 'A test project',
            lastModified: new Date().toISOString()
          },
          {
            id: 2,
            name: 'Another Project',
            path: '/home/user/another-project',
            description: 'Another test project',
            lastModified: new Date().toISOString()
          }
        ]
      })
    );
  }),

  rest.post('/api/projects', (req, res, ctx) => {
    const { name, path, description } = req.body;

    if (name && path) {
      return res(
        ctx.status(201),
        ctx.json({
          success: true,
          project: {
            id: 3,
            name,
            path,
            description: description || '',
            lastModified: new Date().toISOString()
          }
        })
      );
    }

    return res(
      ctx.status(400),
      ctx.json({
        success: false,
        error: 'Name and path are required'
      })
    );
  }),

  rest.get('/api/projects/:id', (req, res, ctx) => {
    const { id } = req.params;

    if (id === '1') {
      return res(
        ctx.status(200),
        ctx.json({
          success: true,
          project: {
            id: 1,
            name: 'Test Project',
            path: '/home/user/test-project',
            description: 'A test project',
            lastModified: new Date().toISOString()
          }
        })
      );
    }

    return res(
      ctx.status(404),
      ctx.json({
        success: false,
        error: 'Project not found'
      })
    );
  }),

  // Git endpoints
  rest.get('/api/git/status', (req, res, ctx) => {
    const { project } = req.query;

    if (project) {
      return res(
        ctx.status(200),
        ctx.json({
          success: true,
          status: ' M modified.txt\n?? new.txt\n',
          branch: 'main'
        })
      );
    }

    return res(
      ctx.status(400),
      ctx.json({
        success: false,
        error: 'Project parameter is required'
      })
    );
  }),

  rest.get('/api/git/log', (req, res, ctx) => {
    const { project } = req.query;

    if (project) {
      return res(
        ctx.status(200),
        ctx.json({
          success: true,
          commits: [
            {
              hash: 'abc123',
              message: 'Latest commit',
              author: 'Test User',
              date: new Date().toISOString()
            },
            {
              hash: 'def456',
              message: 'Previous commit',
              author: 'Test User',
              date: new Date(Date.now() - 86400000).toISOString()
            }
          ]
        })
      );
    }

    return res(
      ctx.status(400),
      ctx.json({
        success: false,
        error: 'Project parameter is required'
      })
    );
  }),

  // Settings endpoints
  rest.get('/api/settings', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        settings: {
          theme: 'light',
          fontSize: 14,
          autoSave: true,
          lineNumbers: true,
          wordWrap: true
        }
      })
    );
  }),

  rest.put('/api/settings', (req, res, ctx) => {
    const settings = req.body;

    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        settings: { ...settings }
      })
    );
  }),

  // File system endpoints
  rest.get('/api/files/*', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        content: 'Mock file content for testing'
      })
    );
  }),

  rest.post('/api/files/*', (req, res, ctx) => {
    const { content } = req.body;

    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        message: 'File saved successfully'
      })
    );
  }),

  // Claude API endpoints
  rest.post('/api/claude/chat', (req, res, ctx) => {
    const { message, sessionId } = req.body;

    // Simulate streaming response
    return res(
      ctx.status(200),
      ctx.json({
        success: true,
        response: `Mock Claude response to: ${message}`,
        sessionId,
        timestamp: new Date().toISOString()
      })
    );
  }),

  // Error simulation endpoints
  rest.get('/api/error/500', (req, res, ctx) => {
    return res(
      ctx.status(500),
      ctx.json({
        success: false,
        error: 'Internal server error'
      })
    );
  }),

  rest.get('/api/error/404', (req, res, ctx) => {
    return res(
      ctx.status(404),
      ctx.json({
        success: false,
        error: 'Not found'
      })
    );
  }),

  rest.get('/api/error/network', (req, res, ctx) => {
    return res.networkError('Network error');
  })
];

// Create MSW server
export const server = setupServer(...handlers);

// Mock WebSocket for testing
export const mockWebSocket = {
  instances: [],

  create: jest.fn(() => {
    const ws = {
      readyState: 1, // WebSocket.OPEN
      send: jest.fn(),
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),

      // Simulate receiving messages
      simulateMessage: (data) => {
        const messageHandler = ws.addEventListener.mock.calls.find(
          call => call[0] === 'message'
        );
        if (messageHandler) {
          messageHandler[1]({ data: JSON.stringify(data) });
        }
      },

      // Simulate connection open
      simulateOpen: () => {
        const openHandler = ws.addEventListener.mock.calls.find(
          call => call[0] === 'open'
        );
        if (openHandler) {
          openHandler[1]({ type: 'open' });
        }
      },

      // Simulate connection close
      simulateClose: () => {
        const closeHandler = ws.addEventListener.mock.calls.find(
          call => call[0] === 'close'
        );
        if (closeHandler) {
          closeHandler[1]({ type: 'close' });
        }
      },

      // Simulate connection error
      simulateError: (error) => {
        const errorHandler = ws.addEventListener.mock.calls.find(
          call => call[0] === 'error'
        );
        if (errorHandler) {
          errorHandler[1]({ type: 'error', error });
        }
      }
    };

    mockWebSocket.instances.push(ws);
    return ws;
  })
};

// Setup global WebSocket mock
global.WebSocket = mockWebSocket.create;

// Export helper functions for tests
export const createMockWebSocket = () => mockWebSocket.create();

export const getLastWebSocket = () => {
  return mockWebSocket.instances[mockWebSocket.instances.length - 1];
};

export const clearWebSocketMocks = () => {
  mockWebSocket.instances = [];
  mockWebSocket.create.mockClear();
};

// Test data factories
export const createMockUser = (overrides = {}) => ({
  id: 1,
  username: 'testuser',
  email: 'test@example.com',
  ...overrides
});

export const createMockProject = (overrides = {}) => ({
  id: 1,
  name: 'Test Project',
  path: '/home/user/test-project',
  description: 'A test project',
  lastModified: new Date().toISOString(),
  ...overrides
});

export const createMockGitCommit = (overrides = {}) => ({
  hash: 'abc123',
  message: 'Test commit',
  author: 'Test User',
  date: new Date().toISOString(),
  ...overrides
});

export const createMockSettings = (overrides = {}) => ({
  theme: 'light',
  fontSize: 14,
  autoSave: true,
  lineNumbers: true,
  wordWrap: true,
  ...overrides
});