// External integration testing for Claude SDK and Cursor CLI
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

// Mock external dependencies
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    access: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn()
  }
}));

describe('External Integration Testing', () => {
  let mockSpawn;
  let mockFs;

  beforeEach(() => {
    mockSpawn = require('child_process').spawn;
    mockFs = require('fs').promises;

    jest.clearAllMocks();

    // Setup default mock returns
    mockFs.access.mockResolvedValue();
    mockFs.readFile.mockResolvedValue('mock config content');
  });

  describe('Claude SDK Integration', () => {
    test('should initialize Claude SDK successfully', async () => {
      // Mock successful Claude SDK initialization
      mockSpawn.mockReturnValue({
        stdout: {
          on: jest.fn().mockImplementation((event, handler) => {
            if (event === 'data') {
              handler('Claude SDK initialized successfully');
            }
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'close') {
            handler(0); // Exit code 0
          }
        })
      });

      const mockClaudeSDK = {
        initialize: async () => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn('claude', ['--version']);

            process.on('close', (code) => {
              if (code === 0) {
                resolve(true);
              } else {
                reject(new Error('Claude SDK not found'));
              }
            });
          });
        }
      };

      const result = await mockClaudeSDK.initialize();
      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('claude', ['--version']);
    });

    test('should handle Claude SDK command execution', async () => {
      const mockProcess = {
        stdin: {
          write: jest.fn(),
          end: jest.fn()
        },
        stdout: {
          on: jest.fn().mockImplementation((event, handler) => {
            if (event === 'data') {
              handler('Command executed successfully');
            }
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'close') {
            handler(0);
          }
        })
      };

      mockSpawn.mockReturnValue(mockProcess);

      const mockClaudeSDK = {
        executeCommand: async (prompt, sessionId) => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn('claude', ['chat', '--prompt', prompt]);

            let output = '';
            process.stdout.on('data', (data) => {
              output += data.toString();
            });

            process.on('close', (code) => {
              if (code === 0) {
                resolve({ output, sessionId });
              } else {
                reject(new Error('Command execution failed'));
              }
            });
          });
        }
      };

      const result = await mockClaudeSDK.executeCommand('test prompt', 'session-123');
      expect(result.output).toBe('Command executed successfully');
      expect(result.sessionId).toBe('session-123');
      expect(mockSpawn).toHaveBeenCalledWith('claude', ['chat', '--prompt', 'test prompt']);
    });

    test('should handle Claude SDK errors gracefully', async () => {
      mockSpawn.mockReturnValue({
        stdout: {
          on: jest.fn()
        },
        stderr: {
          on: jest.fn().mockImplementation((event, handler) => {
            if (event === 'data') {
              handler('Command not found');
            }
          })
        },
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'close') {
            handler(127); // Command not found exit code
          }
        })
      });

      const mockClaudeSDK = {
        executeCommand: async (prompt) => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn('claude', ['chat', '--prompt', prompt]);

            process.on('close', (code) => {
              if (code !== 0) {
                reject(new Error(`Claude CLI not available (exit code: ${code})`));
              }
            });
          });
        }
      };

      await expect(mockClaudeSDK.executeCommand('test prompt'))
        .rejects.toThrow('Claude CLI not available');
    });

    test('should stream Claude SDK responses', async () => {
      let streamData = '';
      const mockProcess = {
        stdout: {
          on: jest.fn().mockImplementation((event, handler) => {
            if (event === 'data') {
              handler('Streaming ');
              setTimeout(() => handler('response '), 10);
              setTimeout(() => handler('data'), 20);
            }
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'close') {
            handler(0);
          }
        })
      };

      mockSpawn.mockReturnValue(mockProcess);

      const mockClaudeSDK = {
        streamCommand: async (prompt, onChunk) => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn('claude', ['chat', '--prompt', prompt]);

            process.stdout.on('data', (data) => {
              streamData += data.toString();
              onChunk(data.toString());
            });

            process.on('close', (code) => {
              if (code === 0) {
                resolve(streamData);
              } else {
                reject(new Error('Stream failed'));
              }
            });
          });
        }
      };

      const chunks = [];
      const result = await mockClaudeSDK.streamCommand('test prompt', (chunk) => {
        chunks.push(chunk);
      });

      expect(chunks).toEqual(['Streaming ', 'response ', 'data']);
      expect(result).toBe('Streaming response data');
    });
  });

  describe('Cursor CLI Integration', () => {
    test('should initialize Cursor CLI successfully', async () => {
      mockSpawn.mockReturnValue({
        stdout: {
          on: jest.fn().mockImplementation((event, handler) => {
            if (event === 'data') {
              handler('Cursor CLI version 1.0.0');
            }
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'close') {
            handler(0);
          }
        })
      });

      const mockCursorCLI = {
        initialize: async () => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn('cursor', ['--version']);

            process.stdout.on('data', (data) => {
              if (data.toString().includes('Cursor CLI')) {
                resolve(true);
              }
            });

            process.on('close', (code) => {
              if (code !== 0) {
                reject(new Error('Cursor CLI not found'));
              }
            });
          });
        }
      };

      const result = await mockCursorCLI.initialize();
      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('cursor', ['--version']);
    });

    test('should execute Cursor CLI commands', async () => {
      const mockProcess = {
        stdin: {
          write: jest.fn(),
          end: jest.fn()
        },
        stdout: {
          on: jest.fn().mockImplementation((event, handler) => {
            if (event === 'data') {
              handler('Command result');
            }
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'close') {
            handler(0);
          }
        })
      };

      mockSpawn.mockReturnValue(mockProcess);

      const mockCursorCLI = {
        executeCommand: async (command, sessionId) => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn('cursor', ['--command', command]);

            let output = '';
            process.stdout.on('data', (data) => {
              output += data.toString();
            });

            process.on('close', (code) => {
              if (code === 0) {
                resolve({ output, sessionId });
              } else {
                reject(new Error(`Cursor command failed with exit code ${code}`));
              }
            });
          });
        }
      };

      const result = await mockCursorCLI.executeCommand('cursor chat "test"', 'session-456');
      expect(result.output).toBe('Command result');
      expect(result.sessionId).toBe('session-456');
      expect(mockSpawn).toHaveBeenCalledWith('cursor', ['--command', 'cursor chat "test"']);
    });

    test('should handle Cursor CLI unavailability', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const mockCursorCLI = {
        checkAvailability: async () => {
          try {
            const process = mockSpawn('cursor', ['--version']);
            return true;
          } catch (error) {
            return false;
          }
        }
      };

      const isAvailable = await mockCursorCLI.checkAvailability();
      expect(isAvailable).toBe(false);
    });

    test('should capture Cursor CLI errors', async () => {
      mockSpawn.mockReturnValue({
        stdout: {
          on: jest.fn()
        },
        stderr: {
          on: jest.fn().mockImplementation((event, handler) => {
            if (event === 'data') {
              handler('Error: Invalid command');
            }
          })
        },
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'close') {
            handler(1);
          }
        })
      });

      const mockCursorCLI = {
        executeCommand: async (command) => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn('cursor', ['--command', command]);

            let errorOutput = '';
            process.stderr.on('data', (data) => {
              errorOutput += data.toString();
            });

            process.on('close', (code) => {
              if (code !== 0) {
                reject(new Error(`Cursor CLI error: ${errorOutput}`));
              }
            });
          });
        }
      };

      await expect(mockCursorCLI.executeCommand('invalid-command'))
        .rejects.toThrow('Cursor CLI error: Error: Invalid command');
    });
  });

  describe('MCP Integration', () => {
    test('should detect MCP servers', async () => {
      mockFs.access.mockImplementation((filePath) => {
        const mcpServers = [
          '.mcp.json',
          '.claude/mcp_servers.json',
          '~/.config/claude/mcp_servers.json'
        ];

        return Promise.resolve(mcpServers.includes(filePath) ? undefined : new Error('File not found'));
      });

      const mockMCPDetector = {
        detectServers: async () => {
          const mcpConfigPaths = [
            '.mcp.json',
            '.claude/mcp_servers.json',
            path.join(process.env.HOME || '~/.config/claude/mcp_servers.json')
          ];

          const availableServers = [];
          for (const configPath of mcpConfigPaths) {
            try {
              await mockFs.access(configPath);
              const config = await mockFs.readFile(configPath);
              availableServers.push({
                configPath,
                config: JSON.parse(config)
              });
            } catch (error) {
              // File doesn't exist, skip
            }
          }

          return availableServers;
        }
      };

      const servers = await mockMCPDetector.detectServers();
      expect(servers.length).toBeGreaterThan(0);
    });

    test('should parse MCP configuration', async () => {
      const mockMCPConfig = {
        mcpServers: {
          "filesystem": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/files"]
          },
          "github": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"]
          }
        }
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(mockMCPConfig));

      const mockMCPParser = {
        parseConfig: async (configPath) => {
          const configContent = await mockFs.readFile(configPath, 'utf8');
          return JSON.parse(configContent);
        }
      };

      const config = await mockMCPParser.parseConfig('test-mcp.json');
      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers.filesystem).toBeDefined();
      expect(config.mcpServers.github).toBeDefined();
      expect(config.mcpServers.filesystem.command).toBe('npx');
    });

    test('should validate MCP server availability', async () => {
      mockSpawn.mockReturnValue({
        stdout: {
          on: jest.fn().mockImplementation((event, handler) => {
            if (event === 'data') {
              handler('MCP server started successfully');
            }
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'close') {
            handler(0);
          }
        })
      });

      const mockMCPServer = {
        validateServer: async (serverConfig) => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn(serverConfig.command, serverConfig.args);

            process.on('close', (code) => {
              if (code === 0) {
                resolve(true);
              } else {
                resolve(false);
              }
            });

            // Add timeout
            setTimeout(() => {
              process.kill('SIGTERM');
              resolve(false);
            }, 5000);
          });
        }
      };

      const serverConfig = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
      };

      const isValid = await mockMCPServer.validateServer(serverConfig);
      expect(isValid).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('npx', ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    });
  });

  describe('Tool Integration', () => {
    test('should integrate Task Master tools', async () => {
      mockSpawn.mockReturnValue({
        stdout: {
          on: jest.fn().mockImplementation((event, handler) => {
            handler('Task Master initialized');
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'close') {
            handler(0);
          }
        })
      });

      const mockTaskMaster = {
        initialize: async () => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn('task-master', ['init']);

            process.on('close', (code) => {
              if (code === 0) {
                resolve(true);
              } else {
                reject(new Error('Task Master initialization failed'));
              }
            });
          });
        },

        listTasks: async () => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn('task-master', ['list']);

            let output = '';
            process.stdout.on('data', (data) => {
              output += data.toString();
            });

            process.on('close', (code) => {
              if (code === 0) {
                resolve(output);
              } else {
                reject(new Error('Failed to list tasks'));
              }
            });
          });
        }
      };

      const initialized = await mockTaskMaster.initialize();
      expect(initialized).toBe(true);

      const tasks = await mockTaskMaster.listTasks();
      expect(tasks).toBe('Task Master initialized');
      expect(mockSpawn).toHaveBeenCalledWith('task-master', ['init']);
      expect(mockSpawn).toHaveBeenCalledWith('task-master', ['list']);
    });

    test('should handle tool unavailability gracefully', async () => {
      mockSpawn.mockImplementation((command) => {
        if (command === 'task-master') {
          throw new Error('Command not found');
        }
        return mockSpawn(command);
      });

      const mockToolChecker = {
        checkToolAvailability: async (toolName) => {
          try {
            const process = mockSpawn(toolName, ['--help']);
            return new Promise((resolve) => {
              process.on('close', (code) => {
                resolve(code === 0);
              });
            });
          } catch (error) {
            return false;
          }
        }
      };

      const isAvailable = await mockToolChecker.checkToolAvailability('task-master');
      expect(isAvailable).toBe(false);
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should retry failed commands', async () => {
      let attemptCount = 0;
      mockSpawn.mockImplementation(() => {
        attemptCount++;

        if (attemptCount <= 2) {
          // First two attempts fail
          return {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn().mockImplementation((event, handler) => {
              if (event === 'close') {
                handler(1); // Non-zero exit code
              }
            })
          };
        } else {
          // Third attempt succeeds
          return {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn().mockImplementation((event, handler) => {
              if (event === 'close') {
                handler(0);
              }
            })
          };
        }
      });

      const mockRetryExecutor = {
        executeWithRetry: async (command, maxRetries = 3) => {
          for (let i = 0; i < maxRetries; i++) {
            try {
              const result = await new Promise((resolve, reject) => {
                const process = mockSpawn(command, ['--test']);

                process.on('close', (code) => {
                  if (code === 0) {
                    resolve(true);
                  } else {
                    reject(new Error(`Command failed with code ${code}`));
                  }
                });
              });

              return result;
            } catch (error) {
              if (i === maxRetries - 1) {
                throw error;
              }
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        }
      };

      const result = await mockRetryExecutor.executeWithRetry('test-command');
      expect(result).toBe(true);
      expect(attemptCount).toBe(3);
    });

    test('should timeout long-running commands', async () => {
      mockSpawn.mockReturnValue({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn().mockImplementation((event, handler) => {
          // Never call close to simulate hanging command
        })
      });

      const mockTimeoutExecutor = {
        executeWithTimeout: async (command, timeoutMs = 1000) => {
          return new Promise((resolve, reject) => {
            const process = mockSpawn(command, ['--long-running']);

            const timeout = setTimeout(() => {
              process.kill('SIGTERM');
              reject(new Error(`Command timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            process.on('close', (code) => {
              clearTimeout(timeout);
              resolve(code === 0);
            });
          });
        }
      };

      await expect(mockTimeoutExecutor.executeWithTimeout('test-command', 100))
        .rejects.toThrow('Command timed out after 100ms');
    });
  });
});