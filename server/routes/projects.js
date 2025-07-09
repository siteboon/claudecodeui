const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const router = express.Router();

// Directory browsing endpoint
router.get('/browse', async (req, res) => {
  try {
    const { path: dirPath } = req.query;
    
    if (!dirPath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    // Security check - ensure path is absolute and safe
    const absolutePath = path.resolve(dirPath);
    
    // Check if directory exists and is accessible
    try {
      await fs.access(absolutePath);
      const stats = await fs.stat(absolutePath);
      
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Directory not found' });
      } else if (error.code === 'EACCES') {
        return res.status(403).json({ error: 'Permission denied' });
      }
      throw error;
    }

    // Read directory contents
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      // Skip system files and common non-project directories
      if (entry.name.startsWith('.') && entry.name !== '.git') continue;
      if (['node_modules', 'dist', 'build', '.next', '.nuxt'].includes(entry.name)) continue;

      const itemPath = path.join(absolutePath, entry.name);
      const item = {
        name: entry.name,
        path: itemPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        isDirectory: entry.isDirectory()
      };

      items.push(item);
    }

    // Sort directories first, then files
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json({
      path: absolutePath,
      items: items.slice(0, 100) // Limit to 100 items for performance
    });

  } catch (error) {
    console.error('Directory browsing error:', error);
    res.status(500).json({ error: 'Failed to browse directory' });
  }
});

// Project validation endpoint
router.get('/validate', async (req, res) => {
  try {
    const { path: projectPath } = req.query;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const absolutePath = path.resolve(projectPath);
    const validation = {
      valid: false,
      type: 'unknown',
      issues: [],
      suggestions: []
    };

    try {
      // Check if path exists and is accessible
      await fs.access(absolutePath);
      const stats = await fs.stat(absolutePath);
      
      if (!stats.isDirectory()) {
        validation.issues.push('Path is not a directory');
        return res.json(validation);
      }

      // Check for common project indicators
      const files = await fs.readdir(absolutePath);
      const fileSet = new Set(files);

      // Check for package.json (Node.js project)
      if (fileSet.has('package.json')) {
        validation.type = 'nodejs';
        validation.suggestions.push('Node.js project detected (package.json found)');
        validation.valid = true;
      }

      // Check for .git directory
      if (fileSet.has('.git')) {
        validation.suggestions.push('Git repository detected');
        validation.valid = true;
      }

      // Check for Python projects
      if (fileSet.has('requirements.txt') || fileSet.has('pyproject.toml') || fileSet.has('setup.py')) {
        validation.type = 'python';
        validation.suggestions.push('Python project detected');
        validation.valid = true;
      }

      // Check for Java projects
      if (fileSet.has('pom.xml') || fileSet.has('build.gradle')) {
        validation.type = 'java';
        validation.suggestions.push('Java project detected');
        validation.valid = true;
      }

      // Check for common source code files
      const sourceFiles = files.filter(file => {
        const ext = path.extname(file);
        return ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.php'].includes(ext);
      });

      if (sourceFiles.length > 0) {
        validation.valid = true;
        validation.suggestions.push(`Found ${sourceFiles.length} source code files`);
      }

      // Check for README
      const readmeFiles = files.filter(file => 
        file.toLowerCase().startsWith('readme')
      );
      if (readmeFiles.length > 0) {
        validation.suggestions.push('Project documentation found');
      }

      // If no clear project indicators, but has subdirectories, might still be valid
      if (!validation.valid) {
        const dirs = await Promise.all(
          files.map(async (file) => {
            try {
              const filePath = path.join(absolutePath, file);
              const stat = await fs.stat(filePath);
              return stat.isDirectory() ? file : null;
            } catch {
              return null;
            }
          })
        );
        
        const directories = dirs.filter(Boolean);
        if (directories.length > 0) {
          validation.valid = true;
          validation.suggestions.push(`Directory contains ${directories.length} subdirectories`);
        }
      }

      // Final validation
      if (!validation.valid) {
        validation.issues.push('Directory does not appear to contain a valid project');
        validation.suggestions.push('Try selecting a directory that contains source code files');
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        validation.issues.push('Directory not found');
      } else if (error.code === 'EACCES') {
        validation.issues.push('Permission denied');
      } else {
        validation.issues.push('Failed to access directory');
      }
    }

    res.json(validation);

  } catch (error) {
    console.error('Project validation error:', error);
    res.status(500).json({ error: 'Failed to validate project' });
  }
});

// Project initialization endpoint
router.post('/open', async (req, res) => {
  try {
    const { path: projectPath, options = {} } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ error: 'Project path is required' });
    }

    const absolutePath = path.resolve(projectPath);
    
    // Validate path first
    try {
      await fs.access(absolutePath);
      const stats = await fs.stat(absolutePath);
      
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Directory not found' });
      } else if (error.code === 'EACCES') {
        return res.status(403).json({ error: 'Permission denied' });
      }
      throw error;
    }

    // Check if Claude Code CLI is available
    const checkClaude = () => {
      return new Promise((resolve) => {
        const child = spawn('which', ['claude'], { stdio: 'pipe' });
        child.on('close', (code) => {
          resolve(code === 0);
        });
      });
    };

    const claudeAvailable = await checkClaude();
    if (!claudeAvailable) {
      return res.status(500).json({ 
        error: 'Claude Code CLI not found',
        details: 'Please ensure Claude Code CLI is installed and available in PATH'
      });
    }

    // Initialize Claude Code in the project directory
    const initializeProject = () => {
      return new Promise((resolve, reject) => {
        const child = spawn('claude', ['--init'], {
          cwd: absolutePath,
          stdio: 'pipe'
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`Claude init failed with code ${code}: ${stderr}`));
          }
        });

        // Set timeout for initialization
        setTimeout(() => {
          child.kill();
          reject(new Error('Project initialization timed out'));
        }, 30000); // 30 second timeout
      });
    };

    try {
      const initResult = await initializeProject();
      
      // Generate project metadata
      const projectName = path.basename(absolutePath);
      const projectId = `proj_${Date.now()}`;
      
      const project = {
        id: projectId,
        name: projectName,
        path: absolutePath,
        type: 'opened',
        sessions: [],
        metadata: {
          initialized: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          size: await getDirectorySize(absolutePath)
        }
      };

      // Here you would typically save the project to your database
      // For now, we'll just return the project info
      
      res.json({
        success: true,
        project,
        initOutput: initResult.stdout
      });

    } catch (initError) {
      console.error('Project initialization error:', initError);
      res.status(500).json({ 
        error: 'Failed to initialize project',
        details: initError.message 
      });
    }

  } catch (error) {
    console.error('Project opening error:', error);
    res.status(500).json({ error: 'Failed to open project' });
  }
});

// Helper function to get directory size
async function getDirectorySize(dirPath) {
  try {
    const stats = await fs.stat(dirPath);
    if (stats.isFile()) {
      return stats.size;
    }
    
    const files = await fs.readdir(dirPath);
    const sizes = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(dirPath, file);
        try {
          return await getDirectorySize(filePath);
        } catch {
          return 0;
        }
      })
    );
    
    return sizes.reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
}

module.exports = router;