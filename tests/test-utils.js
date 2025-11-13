// General testing utilities
import request from 'supertest';
import { EventEmitter } from 'events';

// Mock application factory
export const createMockApp = () => {
  const mockApp = new EventEmitter();

  mockApp.use = jest.fn();
  mockApp.get = jest.fn();
  mockApp.post = jest.fn();
  mockApp.put = jest.fn();
  mockApp.delete = jest.fn();
  mockApp.listen = jest.fn(() => {
    const mockServer = new EventEmitter();
    mockServer.close = jest.fn();
    return mockServer;
  });

  return mockApp;
};

// Mock Express request/response
export const createMockReqRes = () => {
  const req = {
    body: {},
    params: {},
    query: {},
    headers: {},
    method: 'GET',
    url: '/',
    user: null,
    session: {}
  };

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    end: jest.fn(),
    set: jest.fn().mockReturnThis(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn()
  };

  const next = jest.fn();

  return { req, res, next };
};

// Mock WebSocket
export const createMockWebSocket = () => ({
  readyState: 1, // WebSocket.OPEN
  send: jest.fn(),
  close: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  emit: jest.fn(),
  removeAllListeners: jest.fn(),
  terminate: jest.fn()
});

// Helper for async test execution
export const withTimeout = (promise, timeout = 5000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Test timed out after ${timeout}ms`)), timeout)
    )
  ]);
};

// Test data generators
export const generateTestData = {
  user: (overrides = {}) => ({
    id: 'test-user-1',
    username: 'testuser',
    email: 'test@example.com',
    passwordHash: 'hashed-password',
    createdAt: new Date().toISOString(),
    ...overrides
  }),

  project: (overrides = {}) => ({
    id: 'test-project-1',
    name: 'Test Project',
    path: '/tmp/test-project',
    description: 'A test project',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  }),

  session: (overrides = {}) => ({
    id: 'test-session-1',
    title: 'Test Session',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  }),

  apiKey: (overrides = {}) => ({
    id: 1,
    userId: 1,
    keyName: 'test-key',
    apiKey: 'test-api-key-12345',
    createdAt: new Date().toISOString(),
    ...overrides
  })
};

// HTTP status assertion helpers
export const expectStatus = (response, expectedStatus) => {
  expect(response.status).toBe(expectedStatus);
};

export const expectSuccess = (response) => {
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
};

export const expectError = (response, expectedStatus = 400) => {
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(600);
  if (expectedStatus) {
    expect(response.status).toBe(expectedStatus);
  }
};

// Database assertion helpers
export const expectRecordExists = (db, table, id) => {
  const stmt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
  const record = stmt.get(id);
  expect(record).toBeDefined();
  return record;
};

export const expectRecordCount = (db, table, expectedCount) => {
  const stmt = db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
  const result = stmt.get();
  expect(result.count).toBe(expectedCount);
};

// Clean up utilities
export const cleanupDatabase = async (db) => {
  if (db && typeof db.close === 'function') {
    db.close();
  }
};

export const cleanupMocks = () => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
};