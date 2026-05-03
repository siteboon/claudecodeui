import { describe, test, expect } from 'vitest';

import {
  MCP_PROVIDER_NAMES,
  MCP_SUPPORTED_SCOPES,
  MCP_SUPPORTED_TRANSPORTS,
  MCP_PROVIDER_BUTTON_CLASSES,
  MCP_SUPPORTS_WORKING_DIRECTORY,
} from './constants';

describe('MCP constants include openclaude', () => {
  test('MCP_PROVIDER_NAMES has openclaude', () => {
    expect(MCP_PROVIDER_NAMES).toHaveProperty('openclaude');
    expect(MCP_PROVIDER_NAMES.openclaude).toBe('OpenClaude');
  });

  test('MCP_SUPPORTED_SCOPES has openclaude', () => {
    expect(MCP_SUPPORTED_SCOPES).toHaveProperty('openclaude');
    expect(Array.isArray(MCP_SUPPORTED_SCOPES.openclaude)).toBe(true);
  });

  test('MCP_SUPPORTED_TRANSPORTS has openclaude', () => {
    expect(MCP_SUPPORTED_TRANSPORTS).toHaveProperty('openclaude');
    expect(Array.isArray(MCP_SUPPORTED_TRANSPORTS.openclaude)).toBe(true);
  });

  test('MCP_PROVIDER_BUTTON_CLASSES has openclaude', () => {
    expect(MCP_PROVIDER_BUTTON_CLASSES).toHaveProperty('openclaude');
    expect(typeof MCP_PROVIDER_BUTTON_CLASSES.openclaude).toBe('string');
  });

  test('MCP_SUPPORTS_WORKING_DIRECTORY has openclaude', () => {
    expect(MCP_SUPPORTS_WORKING_DIRECTORY).toHaveProperty('openclaude');
    expect(typeof MCP_SUPPORTS_WORKING_DIRECTORY.openclaude).toBe('boolean');
  });
});
