import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  },
}));

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
    vi.clearAllMocks();
    mockProcess?.removeAllListeners?.();
  });

  describe('spawnClaude', () => {
    it('should spawn a new session with --print when no sessionId is provided', async () => {
      const command = 'what is the capital of France?';
      const options = {
        projectPath: 'test-project',
        cwd: '/tmp/test-project',
      };

      const spawnPromise = spawnClaude(command, options, mockWs);
      // Defer emitting 'close' to ensure listeners are attached
      process.nextTick(() => mockProcess.emit('close', 0));
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
      // Defer emitting 'close' to ensure listeners are attached
      process.nextTick(() => mockProcess.emit('close', 0));
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
        // Defer emitting 'close' to ensure listeners are attached
      process.nextTick(() => mockProcess.emit('close', 0));
        await spawnPromise;

        expect(spawnFunction).toHaveBeenCalledOnce();
        const spawnArgs = spawnFunction.mock.calls[0];

        expect(spawnArgs[1]).toContain('--resume');
        expect(spawnArgs[1]).toContain('session-456');
        expect(mockProcess.stdin.write).not.toHaveBeenCalled();
        expect(mockProcess.stdin.end).not.toHaveBeenCalled();
    });

    it('should reject the promise when the process exits with a non-zero code', async () => {
      const command = 'some failing command';
      const options = {};
      const spawnPromise = spawnClaude(command, options, mockWs);

      process.nextTick(() => mockProcess.emit('close', 1)); // Emit error code

      await expect(spawnPromise).rejects.toThrow('Claude CLI exited with code 1');
    });
  });
});
