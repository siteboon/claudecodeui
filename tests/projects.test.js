// Projects and Git API endpoints tests
import request from 'supertest';
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { setupTestDatabase, cleanupTestDatabase } from './database.js';
import { createMockApp } from './test-utils.js';
import projectsRoutes from '../server/routes/projects.js';
import gitRoutes from '../server/routes/git.js';

// Mock dependencies
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    access: jest.fn(),
    realpath: jest.fn(),
    lstat: jest.fn(),
    readlink: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn()
  }
}));

jest.mock('child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn()
}));

describe('Projects Routes', () => {
  let app;
  let mockFs;
  let mockExec;
  let mockSpawn;
  let originalEnv;

  beforeEach(async () => {
    // Store original environment
    originalEnv = process.env;

    // Setup test environment
    process.env.WORKSPACES_ROOT = '/home/test/workspaces';

    // Get mocked modules
    mockFs = require('fs').promises;
    mockExec = require('child_process').exec;
    mockSpawn = require('child_process').spawn;

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock returns
    mockFs.realpath.mockImplementation((p) => Promise.resolve(p));
    mockFs.access.mockResolvedValue();
    mockFs.lstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isDirectory: () => true
    });

    // Create Express app with routes
    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRoutes);
    app.use('/api/git', gitRoutes);
  });

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv;
    await cleanupTestDatabase();
  });

  describe('Workspace Path Validation', () => {
    test('should validate safe workspace path', async () => {
      mockFs.realpath
        .mockResolvedValueOnce('/home/test/workspaces')
        .mockResolvedValueOnce('/home/test/workspaces/myproject');

      const response = await request(app)
        .post('/api/projects/create-workspace')
        .send({
          path: '/home/test/workspaces/myproject',
          name: 'My Project'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    test('should reject workspace in system directory', async () => {
      mockFs.realpath.mockResolvedValue('/etc');

      const response = await request(app)
        .post('/api/projects/create-workspace')
        .send({
          path: '/etc',
          name: 'System Directory'
        })
        .expect(400);

      expect(response.body.error).toContain('Cannot create workspace in system directory');
    });

    test('should reject workspace outside allowed root', async () => {
      mockFs.realpath
        .mockResolvedValueOnce('/home/test/workspaces')
        .mockResolvedValueOnce('/home/unauthorized/project');

      const response = await request(app)
        .post('/api/projects/create-workspace')
        .send({
          path: '/home/unauthorized/project',
          name: 'Unauthorized Project'
        })
        .expect(400);

      expect(response.body.error).toContain('Workspace path must be within the allowed workspace root');
    });

    test('should handle path validation errors gracefully', async () => {
      mockFs.realpath.mockRejectedValue(new Error('Permission denied'));

      const response = await request(app)
        .post('/api/projects/create-workspace')
        .send({
          path: '/forbidden/path',
          name: 'Test Project'
        })
        .expect(400);

      expect(response.body.error).toContain('Path validation failed');
    });

    test('should allow symlinks within workspace root', async () => {
      mockFs.realpath
        .mockResolvedValueOnce('/home/test/workspaces')
        .mockResolvedValueOnce('/home/test/workspaces/myproject');
      mockFs.lstat.mockResolvedValue({
        isSymbolicLink: () => true,
        isDirectory: () => true
      });
      mockFs.readlink.mockResolvedValue('../target-project');

      const response = await request(app)
        .post('/api/projects/create-workspace')
        .send({
          path: '/home/test/workspaces/myproject',
          name: 'Symlink Project'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    test('should reject symlinks outside workspace root', async () => {
      mockFs.realpath
        .mockResolvedValueOnce('/home/test/workspaces')
        .mockResolvedValueOnce('/home/test/workspaces/myproject')
        .mockResolvedValueOnce('/home/unauthorized/target');
      mockFs.lstat.mockResolvedValue({
        isSymbolicLink: () => true,
        isDirectory: () => true
      });
      mockFs.readlink.mockResolvedValue('/home/unauthorized/target');

      const response = await request(app)
        .post('/api/projects/create-workspace')
        .send({
          path: '/home/test/workspaces/myproject',
          name: 'Bad Symlink Project'
        })
        .expect(400);

      expect(response.body.error).toContain('Symlink target is outside the allowed workspace root');
    });
  });
});

describe('Git Routes', () => {
  let app;
  let mockFs;
  let mockExec;

  beforeEach(async () => {
    // Setup test environment
    process.env.WORKSPACES_ROOT = '/home/test/workspaces';

    // Get mocked modules
    mockFs = require('fs').promises;
    mockExec = require('child_process').exec;

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock returns
    mockFs.access.mockResolvedValue();
    mockFs.readFile.mockResolvedValue('git file content');

    mockExec.mockImplementation((command, callback) => {
      // Simulate successful git commands
      const commands = {
        'git status --porcelain': { stdout: ' M modified.txt\n?? new.txt\n' },
        'git diff --cached': { stdout: 'diff content' },
        'git diff': { stdout: 'diff content' },
        'git log --oneline -10': { stdout: 'abc123 Latest commit\n' },
        'git branch -a': { stdout: '* main\n  feature/test\n' },
        'git remote -v': { stdout: 'origin https://github.com/user/repo.git (fetch)\n' }
      };

      const result = commands[command] || { stdout: '', stderr: '' };
      callback(null, result.stdout, result.stderr);
    });

    // Create Express app with git routes only
    app = express();
    app.use(express.json());
    app.use('/api/git', gitRoutes);
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('Git Status', () => {
    test('should return git status', async () => {
      const response = await request(app)
        .get('/api/git/status')
        .query({ project: 'myproject' })
        .expect(200);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git status --porcelain'),
        expect.any(Function)
      );
      expect(response.body.success).toBe(true);
    });

    test('should handle git status errors', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback(new Error('Git command failed'), '', '');
      });

      const response = await request(app)
        .get('/api/git/status')
        .query({ project: 'myproject' })
        .expect(500);

      expect(response.body.error).toContain('Git command failed');
    });

    test('should reject requests without project parameter', async () => {
      const response = await request(app)
        .get('/api/git/status')
        .expect(400);

      expect(response.body.error).toContain('Project parameter is required');
    });
  });

  describe('Git Diff', () => {
    test('should return git diff', async () => {
      const response = await request(app)
        .get('/api/git/diff')
        .query({ project: 'myproject' })
        .expect(200);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git diff'),
        expect.any(Function)
      );
      expect(response.body.success).toBe(true);
    });

    test('should return staged diff when requested', async () => {
      const response = await request(app)
        .get('/api/git/diff')
        .query({ project: 'myproject', staged: 'true' })
        .expect(200);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git diff --cached'),
        expect.any(Function)
      );
      expect(response.body.success).toBe(true);
    });

    test('should strip diff headers correctly', async () => {
      mockExec.mockImplementation((command, callback) => {
        const mockDiff = `diff --git a/test.txt b/test.txt
index abc123..def456 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
-line1
+line1 modified
 line2
 line3`;
        callback(null, mockDiff, '');
      });

      const response = await request(app)
        .get('/api/git/diff')
        .query({ project: 'myproject' })
        .expect(200);

      expect(response.body.diff).not.toContain('diff --git');
      expect(response.body.diff).not.toContain('index ');
      expect(response.body.diff).not.toContain('---');
      expect(response.body.diff).not.toContain('+++');
      expect(response.body.diff).toContain('@@ -1,3 +1,3 @@');
    });
  });

  describe('Git Log', () => {
    test('should return git log', async () => {
      const response = await request(app)
        .get('/api/git/log')
        .query({ project: 'myproject' })
        .expect(200);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git log --oneline -10'),
        expect.any(Function)
      );
      expect(response.body.success).toBe(true);
    });

    test('should return limited log entries when count is specified', async () => {
      const response = await request(app)
        .get('/api/git/log')
        .query({ project: 'myproject', count: '5' })
        .expect(200);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git log --oneline -5'),
        expect.any(Function)
      );
      expect(response.body.success).toBe(true);
    });
  });

  describe('Git Branches', () => {
    test('should return git branches', async () => {
      const response = await request(app)
        .get('/api/git/branches')
        .query({ project: 'myproject' })
        .expect(200);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git branch -a'),
        expect.any(Function)
      );
      expect(response.body.success).toBe(true);
    });

    test('should parse branch information correctly', async () => {
      mockExec.mockImplementation((command, callback) => {
        const mockBranches = '* main\n  feature/test\n  feature/another\n  remotes/origin/main';
        callback(null, mockBranches, '');
      });

      const response = await request(app)
        .get('/api/git/branches')
        .query({ project: 'myproject' })
        .expect(200);

      expect(response.body.branches).toContain('main');
      expect(response.body.currentBranch).toBe('main');
    });
  });

  describe('Git Remote', () => {
    test('should return git remotes', async () => {
      const response = await request(app)
        .get('/api/git/remote')
        .query({ project: 'myproject' })
        .expect(200);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git remote -v'),
        expect.any(Function)
      );
      expect(response.body.success).toBe(true);
    });

    test('should parse remote information correctly', async () => {
      mockExec.mockImplementation((command, callback) => {
        const mockRemotes = 'origin\thttps://github.com/user/repo.git (fetch)\norigin\thttps://github.com/user/repo.git (push)';
        callback(null, mockRemotes, '');
      });

      const response = await request(app)
        .get('/api/git/remote')
        .query({ project: 'myproject' })
        .expect(200);

      expect(response.body.remotes[0].name).toBe('origin');
      expect(response.body.remotes[0].url).toBe('https://github.com/user/repo.git');
    });
  });
});