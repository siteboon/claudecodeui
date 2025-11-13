// Simplified Mock Service Worker setup for API mocking
import { setupServer } from 'msw/node';
import { http } from 'msw';
import { jest } from '@jest/globals';

// Mock handlers for API endpoints using MSW v2 syntax
export const handlers = [
  // Authentication endpoints
  http.post('/api/auth/login', async ({ request }) => {
    const { username, password } = await request.json();

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

  http.get('/api/projects', () => {
    return Response.json({
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
    });
  }),

  // Error simulation endpoints
  http.get('/api/error/500', () => {
    return Response.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }),

  http.get('/api/error/404', () => {
    return Response.json({
      success: false,
      error: 'Not found'
    }, { status: 404 });
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
      }
    };

    mockWebSocket.instances.push(ws);
    return ws;
  })
};

// Setup global WebSocket mock
global.WebSocket = mockWebSocket.create;

// Export helper functions for tests
export const getLastWebSocket = () => {
  return mockWebSocket.instances[mockWebSocket.instances.length - 1];
};

export const clearWebSocketMocks = () => {
  mockWebSocket.instances = [];
  mockWebSocket.create.mockClear();
};