// Example test file to verify Jest configuration
import { testDb, setupTestDatabase, seedTestDatabase, cleanupTestDatabase } from './database.js';
import { createMockApp, createMockReqRes, generateTestData } from './test-utils.js';

describe('Test Infrastructure', () => {
  let db;

  beforeAll(async () => {
    db = await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Clean up and reseed for each test
    db.exec('DELETE FROM users');
    db.exec('DELETE FROM api_keys');
    await seedTestDatabase();
  });

  describe('Database Setup', () => {
    test('should create database tables', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const tableNames = tables.map(t => t.name);

      expect(tableNames).toContain('users');
      expect(tableNames).toContain('api_keys');
      expect(tableNames).toContain('user_credentials');
    });

    test('should seed test data', () => {
      const users = db.prepare('SELECT * FROM users').all();
      const apiKeys = db.prepare('SELECT * FROM api_keys').all();

      expect(users).toHaveLength(1);
      expect(apiKeys).toHaveLength(1);
      expect(users[0].username).toBe('testuser');
      expect(apiKeys[0].api_key).toBe('test-api-key-12345');
    });
  });

  describe('Test Utilities', () => {
    test('should generate test data', () => {
      const user = generateTestData.user();
      const project = generateTestData.project();

      expect(user).toHaveProperty('id', 'test-user-1');
      expect(user).toHaveProperty('username', 'testuser');
      expect(project).toHaveProperty('id', 'test-project-1');
      expect(project).toHaveProperty('name', 'Test Project');
    });

    test('should create mock Express objects', () => {
      const { req, res, next } = createMockReqRes();

      expect(typeof res.status).toBe('function');
      expect(typeof res.json).toBe('function');
      expect(typeof next).toBe('function');
    });

    test('should use global test utilities', () => {
      const token = global.testUtils.createTestToken('test-user');
      const project = global.testUtils.createTestProject();
      const ws = global.testUtils.mockWebSocket();

      expect(token).toBeTruthy();
      expect(project.id).toBe('test-project-1');
      expect(typeof ws.send).toBe('function');
      expect(typeof ws.close).toBe('function');
    });
  });

  describe('Mock Framework', () => {
    test('should mock functions correctly', () => {
      const mockFn = jest.fn();
      mockFn('test');

      expect(mockFn).toHaveBeenCalledWith('test');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    test('should create mock app', () => {
      const app = createMockApp();

      expect(typeof app.use).toBe('function');
      expect(typeof app.get).toBe('function');
      expect(typeof app.post).toBe('function');
      expect(typeof app.listen).toBe('function');
    });
  });

  describe('Environment Setup', () => {
    test('should have test environment variables', () => {
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.PORT).toBe('3002');
      expect(process.env.DATABASE_PATH).toBe(':memory:');
      expect(process.env.JWT_SECRET).toBe('test-jwt-secret');
    });

    test('should have global timeout set', () => {
      expect(jest.getTimeout()).toBe(10000);
    });
  });
});