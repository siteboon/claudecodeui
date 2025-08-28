import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// 1. Mock the modules with a factory that returns placeholder functions.
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));
vi.mock('cross-spawn', () => ({
  default: vi.fn(),
}));

// 2. Now that the mocks are registered, import the modules.
import { spawn } from 'child_process';
import crossSpawn from 'cross-spawn';
import { spawnClaude } from './claude-cli.js';


describe('claude-cli', () => {
  let mockProcess;
  let mockWs;
  let spawnFunction;

  beforeEach(() => {
    // 3. Before each test, create a fresh mock process.
    mockProcess = new EventEmitter();
    mockProcess.stdin = { write: vi.fn(), end: vi.fn() };
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    // 4. Configure the mocked functions to return our mock process.
    spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;
    spawnFunction.mockReturnValue(mockProcess);

    mockWs = {
      send: vi.fn(),
      close: vi.fn(),
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('spawnClaude', () => {
    it('should spawn a new session with --print when no sessionId is provided', async () => {
      const command = 'what is the capital of France?';
      const options = {
        projectPath: 'test-project',
        cwd: '/tmp/test-project',
      };

      const spawnPromise = spawnClaude(command, options, mockWs);
      // Make the mock process exit to allow the promise to resolve
      mockProcess.emit('close', 0);
      await spawnPromise;

      expect(spawnFunction).toHaveBeenCalledOnce();
      const spawnArgs = spawnFunction.mock.calls[0];

      expect(spawnArgs[0]).toBe('claude');
      expect(spawnArgs[1]).toContain('--print');
      expect(spawnArgs[1]).toContain(command);
      expect(spawnArgs[1]).not.toContain('--resume');

      expect(mockProcess.stdin.write).not.toHaveBeenCalled();
      expect(mockProcess.stdin.end).toHaveBeenCalledOnce();
    });

    it('should resume a session with --resume and use stdin when a sessionId is provided', async () => {
      const command = 'and what is its population?';
      const options = {
        sessionId: 'session-123',
        projectPath: 'test-project',
        cwd: '/tmp/test-project',
        resume: true,
      };

      const spawnPromise = spawnClaude(command, options, mockWs);
      mockProcess.emit('close', 0);
      await spawnPromise;

      expect(spawnFunction).toHaveBeenCalledOnce();
      const spawnArgs = spawnFunction.mock.calls[0];

      expect(spawnArgs[0]).toBe('claude');
      expect(spawnArgs[1]).not.toContain('--print');
      expect(spawnArgs[1]).toContain('--resume');
      expect(spawnArgs[1]).toContain('session-123');

      expect(mockProcess.stdin.write).toHaveBeenCalledOnce();
      expect(mockProcess.stdin.write).toHaveBeenCalledWith(command + '\n');
      expect(mockProcess.stdin.end).toHaveBeenCalledOnce();
    });

    it('should handle resumed sessions with no command (interactive)', async () => {
        const options = { sessionId: 'session-456', resume: true };

        const spawnPromise = spawnClaude('', options, mockWs);
        mockProcess.emit('close', 0);
        await spawnPromise;

        expect(spawnFunction).toHaveBeenCalledOnce();
        const spawnArgs = spawnFunction.mock.calls[0];

        expect(spawnArgs[1]).toContain('--resume');
        expect(spawnArgs[1]).toContain('session-456');
        expect(mockProcess.stdin.write).not.toHaveBeenCalled();
        expect(mockProcess.stdin.end).not.toHaveBeenCalled();
    });
  });
});
