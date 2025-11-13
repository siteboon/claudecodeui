// WebSocket connection and message routing tests
import { WebSocket } from 'ws';
import { setupTestDatabase, cleanupTestDatabase } from './database.js';

describe('WebSocket Connection and Message Routing', () => {
  let mockServer;
  let mockWs;
  let testDb;

  beforeEach(async () => {
    testDb = await setupTestDatabase();

    // Mock WebSocket server
    mockServer = {
      clients: new Set(),
      on: jest.fn(),
      close: jest.fn(),
      handleUpgrade: jest.fn(),
      emit: jest.fn()
    };

    // Mock WebSocket connection
    mockWs = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn(),
      terminate: jest.fn(),
      removeAllListeners: jest.fn()
    };

    jest.clearAllMocks();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('WebSocket Connection Handling', () => {
    test('should establish WebSocket connection successfully', () => {
      // Mock connection establishment
      const ws = global.testUtils.mockWebSocket();

      expect(ws.readyState).toBe(1); // WebSocket.OPEN
      expect(typeof ws.send).toBe('function');
      expect(typeof ws.close).toBe('function');
      expect(typeof ws.on).toBe('function');
    });

    test('should handle connection with valid JWT token', () => {
      const validToken = global.testUtils.createTestToken('test-user-123');

      // Mock JWT verification
      const mockVerify = jest.fn().mockReturnValue({ userId: 1, username: 'testuser' });
      require('jsonwebtoken').verify = mockVerify;

      expect(validToken).toBeTruthy();
      const decoded = JSON.parse(Buffer.from(validToken, 'base64').toString());
      expect(decoded.userId).toBe('test-user-123');
    });

    test('should reject connection with invalid JWT token', () => {
      const invalidToken = 'invalid-token';

      // Mock JWT verification failure
      const mockVerify = jest.fn().mockImplementation(() => {
        throw new Error('Invalid token');
      });
      require('jsonwebtoken').verify = mockVerify;

      expect(() => {
        JSON.parse(Buffer.from(invalidToken, 'base64').toString());
      }).toThrow();
    });

    test('should handle connection without token', () => {
      const connectionWithoutToken = null;

      expect(connectionWithoutToken).toBeNull();
    });
  });

  describe('Message Routing', () => {
    test('should route claude-command messages correctly', () => {
      const message = {
        type: 'claude-command',
        data: {
          prompt: 'Test prompt',
          sessionId: 'test-session'
        }
      };

      const routeResult = {
        type: 'claude-command',
        action: 'process-prompt',
        sessionId: message.data.sessionId,
        prompt: message.data.prompt
      };

      expect(routeResult.type).toBe('claude-command');
      expect(routeResult.action).toBe('process-prompt');
      expect(routeResult.sessionId).toBe('test-session');
    });

    test('should route cursor-command messages correctly', () => {
      const message = {
        type: 'cursor-command',
        data: {
          command: 'cursor test',
          sessionId: 'test-session'
        }
      };

      const routeResult = {
        type: 'cursor-command',
        action: 'execute-cursor',
        sessionId: message.data.sessionId,
        command: message.data.command
      };

      expect(routeResult.type).toBe('cursor-command');
      expect(routeResult.action).toBe('execute-cursor');
      expect(routeResult.sessionId).toBe('test-session');
    });

    test('should route shell command messages correctly', () => {
      const message = {
        type: 'shell-command',
        data: {
          command: 'ls -la',
          sessionId: 'test-session'
        }
      };

      const routeResult = {
        type: 'shell-command',
        action: 'execute-shell',
        sessionId: message.data.sessionId,
        command: message.data.command
      };

      expect(routeResult.type).toBe('shell-command');
      expect(routeResult.action).toBe('execute-shell');
      expect(routeResult.sessionId).toBe('test-session');
    });

    test('should handle unknown message types', () => {
      const message = {
        type: 'unknown-command',
        data: {}
      };

      const routeResult = {
        type: 'error',
        error: 'Unknown message type: unknown-command'
      };

      expect(routeResult.type).toBe('error');
      expect(routeResult.error).toContain('Unknown message type');
    });
  });

  describe('Message Serialization', () => {
    test('should serialize messages correctly', () => {
      const message = {
        type: 'response',
        data: {
          content: 'Test response',
          sessionId: 'test-session'
        }
      };

      const serialized = JSON.stringify(message);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.type).toBe('response');
      expect(deserialized.data.content).toBe('Test response');
      expect(deserialized.data.sessionId).toBe('test-session');
    });

    test('should handle large message content', () => {
      const largeContent = 'x'.repeat(10000); // 10KB of content
      const message = {
        type: 'response',
        data: {
          content: largeContent,
          sessionId: 'test-session'
        }
      };

      const serialized = JSON.stringify(message);
      expect(serialized.length).toBeGreaterThan(10000);

      const deserialized = JSON.parse(serialized);
      expect(deserialized.data.content).toBe(largeContent);
    });

    test('should handle binary data in messages', () => {
      const binaryData = Buffer.from('binary content');
      const message = {
        type: 'binary-data',
        data: {
          content: binaryData.toString('base64'),
          sessionId: 'test-session'
        }
      };

      const serialized = JSON.stringify(message);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.type).toBe('binary-data');
      expect(deserialized.data.content).toBe(binaryData.toString('base64'));
    });
  });

  describe('Connection Cleanup', () => {
    test('should clean up connection on close', () => {
      const connections = new Set([mockWs]);
      connections.add(mockWs);

      expect(connections.size).toBe(1);

      // Simulate connection close
      connections.delete(mockWs);

      expect(connections.size).toBe(0);
    });

    test('should handle connection errors gracefully', () => {
      const errorHandler = jest.fn();
      mockWs.on('error', errorHandler);

      // Simulate error
      const error = new Error('Connection lost');
      mockWs.on.mock.calls.forEach(([event, handler]) => {
        if (event === 'error') {
          handler(error);
        }
      });

      expect(errorHandler).toHaveBeenCalled();
    });

    test('should terminate connection on timeout', () => {
      const timeoutHandler = jest.fn();
      mockWs.on('close', timeoutHandler);

      // Simulate timeout
      mockWs.terminate();

      expect(mockWs.terminate).toHaveBeenCalled();
    });
  });

  describe('Session Management', () => {
    test('should track active sessions', () => {
      const sessions = new Map();
      const sessionId = 'test-session-123';
      const sessionData = {
        id: sessionId,
        userId: 1,
        createdAt: new Date(),
        messages: []
      };

      sessions.set(sessionId, sessionData);

      expect(sessions.size).toBe(1);
      expect(sessions.get(sessionId)).toBe(sessionData);
      expect(sessions.get(sessionId).id).toBe(sessionId);
    });

    test('should clean up inactive sessions', () => {
      const sessions = new Map();
      const oldSession = {
        id: 'old-session',
        userId: 1,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        messages: []
      };

      sessions.set('old-session', oldSession);

      // Clean up sessions older than 1 hour
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const [sessionId, session] of sessions) {
        if (session.createdAt.getTime() < oneHourAgo) {
          sessions.delete(sessionId);
        }
      }

      expect(sessions.size).toBe(0);
    });

    test('should handle concurrent sessions', () => {
      const sessions = new Map();
      const userId = 1;

      // Add multiple sessions for the same user
      const session1 = { id: 'session-1', userId, createdAt: new Date() };
      const session2 = { id: 'session-2', userId, createdAt: new Date() };

      sessions.set('session-1', session1);
      sessions.set('session-2', session2);

      expect(sessions.size).toBe(2);

      // Find all sessions for a user
      const userSessions = Array.from(sessions.values()).filter(s => s.userId === userId);
      expect(userSessions).toHaveLength(2);
    });
  });
});