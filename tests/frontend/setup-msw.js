// MSW setup for Jest
import { server } from './mocks/server.js';

// Setup MSW server before all tests
beforeAll(() => {
  server.listen({
    onUnhandledRequest: 'warn',
  });
});

// Reset request handlers after each test
afterEach(() => {
  server.resetHandlers();
});

// Close MSW server after all tests
afterAll(() => {
  server.close();
});

// Export for use in individual test files if needed
export { server };