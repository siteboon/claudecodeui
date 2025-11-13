// Test setup file for Jest
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3002'; // Different port for testing
process.env.DATABASE_PATH = ':memory:'; // In-memory database for tests
process.env.JWT_SECRET = 'test-jwt-secret';


// Setup and teardown hooks
beforeAll(async () => {
  // Global setup before all tests
  console.log('🧪 Test suite starting...');
});

afterAll(async () => {
  // Global cleanup after all tests
  console.log('🧪 Test suite completed');
});

// Note: jest.clearAllMocks() and jest.restoreAllMocks() are available automatically
// No need to call them explicitly here as Jest handles this automatically

// Global test utilities
global.testUtils = {
  // Create a test JWT token
  createTestToken: (userId = 'test-user') => {
    return Buffer.from(JSON.stringify({ userId })).toString('base64');
  },

  // Create test project data
  createTestProject: () => ({
    id: 'test-project-1',
    name: 'Test Project',
    path: '/tmp/test-project',
    description: 'A test project for testing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }),

  // Mock WebSocket connections
  mockWebSocket: () => {
    // Mock functions that will be replaced by jest.fn() in test context
    return {
      send: () => {},
      close: () => {},
      readyState: 1, // OPEN
      on: () => {},
      emit: () => {},
      removeAllListeners: () => {}
    };
  }
};