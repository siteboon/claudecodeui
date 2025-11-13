// Basic test to verify frontend testing setup
import { test, expect } from '@jest/globals';

test('should pass a basic test', () => {
  expect(1 + 1).toBe(2);
});

test('should handle async operations', async () => {
  const result = await Promise.resolve('hello');
  expect(result).toBe('hello');
});