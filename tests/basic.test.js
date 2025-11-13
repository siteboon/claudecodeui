// Basic test file to verify Jest configuration
describe('Jest Configuration', () => {
  test('should have test environment variables set', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.PORT).toBe('3002');
    expect(process.env.DATABASE_PATH).toBe(':memory:');
    expect(process.env.JWT_SECRET).toBe('test-jwt-secret');
  });

  test('should have global test utilities available', () => {
    expect(global.testUtils).toBeDefined();
    expect(typeof global.testUtils.createTestToken).toBe('function');
    expect(typeof global.testUtils.createTestProject).toBe('function');
    expect(typeof global.testUtils.mockWebSocket).toBe('function');
  });

  test('should create test token correctly', () => {
    const token = global.testUtils.createTestToken('test-user-123');
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    expect(decoded.userId).toBe('test-user-123');
  });

  test('should create test project correctly', () => {
    const project = global.testUtils.createTestProject();
    expect(project).toHaveProperty('id', 'test-project-1');
    expect(project).toHaveProperty('name', 'Test Project');
    expect(project).toHaveProperty('path', '/tmp/test-project');
    expect(project).toHaveProperty('description', 'A test project for testing');
    expect(project).toHaveProperty('createdAt');
    expect(project).toHaveProperty('updatedAt');
  });

  test('should mock WebSocket correctly', () => {
    const ws = global.testUtils.mockWebSocket();
    expect(ws).toHaveProperty('readyState', 1);
    expect(typeof ws.send).toBe('function');
    expect(typeof ws.close).toBe('function');
    expect(typeof ws.on).toBe('function');
    expect(typeof ws.emit).toBe('function');
    expect(typeof ws.removeAllListeners).toBe('function');
  });

  test('should handle async operations', async () => {
    const result = await new Promise(resolve => {
      setTimeout(() => resolve('async-test'), 100);
    });
    expect(result).toBe('async-test');
  });

  test('should support basic assertions', () => {
    // Basic test without jest.fn for now
    expect(true).toBe(true);
    expect(1 + 1).toBe(2);
    expect([]).toEqual([]);
    expect({ test: 'value' }).toHaveProperty('test');
  });
});