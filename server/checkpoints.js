const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { extractProjectDirectory } = require('./projects');

const execAsync = promisify(exec);

// File-based storage for checkpoints to persist across server restarts
const CHECKPOINTS_FILE = path.join(__dirname, 'checkpoints.json');

// Load checkpoints from disk
function loadCheckpoints() {
  try {
    const data = require('fs').readFileSync(CHECKPOINTS_FILE, 'utf8');
    return new Map(Object.entries(JSON.parse(data)));
  } catch (error) {
    // File doesn't exist or is corrupted, start with empty map
    return new Map();
  }
}

// Save checkpoints to disk
function saveCheckpoints(checkpoints) {
  try {
    const data = JSON.stringify(Object.fromEntries(checkpoints));
    require('fs').writeFileSync(CHECKPOINTS_FILE, data, 'utf8');
  } catch (error) {
    console.error('Failed to save checkpoints:', error);
  }
}

// Initialize checkpoints from disk
const checkpoints = loadCheckpoints();

/**
 * Creates a checkpoint by capturing the current state of modified files in a project
 * @param {string} projectName - The encoded project name
 * @param {string} promptId - Unique identifier for the prompt/checkpoint
 * @param {string} userMessage - The user's prompt message
 * @returns {Promise<Object>} Checkpoint metadata
 */
async function createCheckpoint(projectName, promptId, userMessage) {
  try {
    const projectPath = await extractProjectDirectory(projectName);
    console.log('📍 Creating checkpoint for project:', projectName, 'at path:', projectPath);
    
    // Check if directory exists
    await fs.access(projectPath);
    
    // Get git status to find modified files
    let modifiedFiles = [];
    try {
      // Get all modified, added, and untracked files
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: projectPath });
      
      modifiedFiles = statusOutput
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const status = line.substring(0, 2);
          const filePath = line.substring(3);
          return { status: status.trim(), path: filePath };
        });
    } catch (gitError) {
      console.warn('Git not available or not a git repo, capturing all files in project:', gitError.message);
      
      // Fallback: capture key project files if git is not available
      const commonFiles = [
        'package.json', 'src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx',
        'src/**/*.css', 'src/**/*.scss', '*.md', '*.json', '*.config.js'
      ];
      
      for (const pattern of commonFiles) {
        try {
          const { stdout } = await execAsync(`find . -name "${pattern}" -type f`, { cwd: projectPath });
          const files = stdout.split('\n').filter(f => f.trim() && !f.includes('node_modules'));
          modifiedFiles.push(...files.map(f => ({ status: 'M', path: f.replace('./', '') })));
        } catch (e) {
          // Ignore find errors
        }
      }
    }
    
    // Capture file contents
    const fileStates = {};
    for (const file of modifiedFiles) {
      try {
        const fullPath = path.join(projectPath, file.path);
        
        // Check if file exists and is readable
        await fs.access(fullPath, fs.constants.R_OK);
        
        // Read file content
        const content = await fs.readFile(fullPath, 'utf8');
        fileStates[file.path] = {
          content,
          status: file.status,
          capturedAt: new Date().toISOString()
        };
      } catch (error) {
        console.warn(`Could not capture file ${file.path}:`, error.message);
      }
    }
    
    // Create checkpoint metadata
    const checkpoint = {
      id: promptId,
      projectName,
      projectPath,
      userMessage: userMessage.substring(0, 200), // Truncate long messages
      createdAt: new Date().toISOString(),
      fileStates,
      fileCount: Object.keys(fileStates).length
    };
    
    // Store checkpoint
    const checkpointKey = `${projectName}:${promptId}`;
    checkpoints.set(checkpointKey, checkpoint);
    
    // Persist to disk
    saveCheckpoints(checkpoints);
    
    console.log(`✅ Checkpoint created: ${checkpoint.fileCount} files captured for prompt: ${userMessage.substring(0, 50)}...`);
    
    return {
      success: true,
      checkpointId: promptId,
      fileCount: checkpoint.fileCount,
      createdAt: checkpoint.createdAt
    };
    
  } catch (error) {
    console.error('❌ Error creating checkpoint:', error);
    throw new Error(`Failed to create checkpoint: ${error.message}`);
  }
}

/**
 * Restores files to their state at a specific checkpoint
 * @param {string} projectName - The encoded project name
 * @param {string} promptId - The checkpoint identifier
 * @returns {Promise<Object>} Restoration result
 */
async function restoreCheckpoint(projectName, promptId) {
  try {
    const checkpointKey = `${projectName}:${promptId}`;
    console.log('🔍 Looking for checkpoint:', checkpointKey);
    console.log('🔍 Available checkpoints:', Array.from(checkpoints.keys()));
    console.log('🔍 Total checkpoints in memory:', checkpoints.size);
    
    const checkpoint = checkpoints.get(checkpointKey);
    
    if (!checkpoint) {
      console.log('❌ Checkpoint not found in memory, reloading from disk...');
      // Try reloading from disk in case of sync issues
      const reloadedCheckpoints = loadCheckpoints();
      const reloadedCheckpoint = reloadedCheckpoints.get(checkpointKey);
      
      if (reloadedCheckpoint) {
        console.log('✅ Found checkpoint on disk, updating memory...');
        checkpoints.clear();
        for (const [key, value] of reloadedCheckpoints) {
          checkpoints.set(key, value);
        }
        return await restoreCheckpoint(projectName, promptId); // Retry
      }
      
      throw new Error(`Checkpoint not found: ${promptId}`);
    }
    
    const projectPath = await extractProjectDirectory(projectName);
    console.log('🔄 Restoring checkpoint for project:', projectName, 'at path:', projectPath);
    
    // Verify project path still exists
    await fs.access(projectPath);
    
    const restoredFiles = [];
    const deletedFiles = [];
    const errors = [];
    
    // Get current modified files to compare against checkpoint
    let currentModifiedFiles = [];
    try {
      // Get all modified, added, and untracked files currently
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: projectPath });
      
      currentModifiedFiles = statusOutput
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.substring(3)); // Remove status prefix
    } catch (gitError) {
      console.warn('Git not available, using file-based detection');
      
      // Fallback: check for common project files if git not available
      const commonPatterns = ['*.js', '*.jsx', '*.ts', '*.tsx', '*.css', '*.json', '*.md'];
      for (const pattern of commonPatterns) {
        try {
          const { stdout } = await execAsync(`find . -name "${pattern}" -type f`, { cwd: projectPath });
          const files = stdout.split('\n').filter(f => f.trim() && !f.includes('node_modules'));
          currentModifiedFiles.push(...files.map(f => f.replace('./', '')));
        } catch (e) {
          // Ignore find errors
        }
      }
    }
    
    // Delete files that exist now but weren't in the checkpoint
    for (const currentFile of currentModifiedFiles) {
      if (!checkpoint.fileStates[currentFile]) {
        try {
          const fullPath = path.join(projectPath, currentFile);
          await fs.unlink(fullPath);
          deletedFiles.push(currentFile);
          console.log(`🗑️ Deleted file that didn't exist at checkpoint: ${currentFile}`);
        } catch (error) {
          console.warn(`Could not delete file ${currentFile}:`, error.message);
          errors.push({ file: currentFile, error: `Delete failed: ${error.message}` });
        }
      }
    }
    
    // Restore each file from checkpoint
    for (const [filePath, fileState] of Object.entries(checkpoint.fileStates)) {
      try {
        const fullPath = path.join(projectPath, filePath);
        
        // Create directory if it doesn't exist
        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });
        
        // Restore file content directly (no backup needed since we're intentionally reverting)
        await fs.writeFile(fullPath, fileState.content, 'utf8');
        restoredFiles.push(filePath);
        
      } catch (error) {
        console.error(`Error restoring file ${filePath}:`, error);
        errors.push({ file: filePath, error: error.message });
      }
    }
    
    console.log(`✅ Checkpoint restored: ${restoredFiles.length} files restored, ${deletedFiles.length} files deleted, ${errors.length} errors`);
    
    return {
      success: true,
      checkpointId: promptId,
      restoredFiles: restoredFiles.length,
      deletedFiles: deletedFiles.length,
      deletedFilesList: deletedFiles,
      errors,
      restoredAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('❌ Error restoring checkpoint:', error);
    throw new Error(`Failed to restore checkpoint: ${error.message}`);
  }
}

/**
 * Gets a list of available checkpoints for a project
 * @param {string} projectName - The encoded project name
 * @returns {Array} List of checkpoint metadata
 */
function getCheckpoints(projectName) {
  const projectCheckpoints = [];
  
  for (const [key, checkpoint] of checkpoints.entries()) {
    if (key.startsWith(`${projectName}:`)) {
      projectCheckpoints.push({
        id: checkpoint.id,
        userMessage: checkpoint.userMessage,
        createdAt: checkpoint.createdAt,
        fileCount: checkpoint.fileCount
      });
    }
  }
  
  // Sort by creation date (newest first)
  return projectCheckpoints.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Deletes a specific checkpoint
 * @param {string} projectName - The encoded project name
 * @param {string} promptId - The checkpoint identifier
 * @returns {boolean} Success status
 */
function deleteCheckpoint(projectName, promptId) {
  const checkpointKey = `${projectName}:${promptId}`;
  const success = checkpoints.delete(checkpointKey);
  if (success) {
    saveCheckpoints(checkpoints);
  }
  return success;
}

/**
 * Clears all checkpoints for a project
 * @param {string} projectName - The encoded project name
 * @returns {number} Number of deleted checkpoints
 */
function clearProjectCheckpoints(projectName) {
  let deleted = 0;
  
  for (const key of checkpoints.keys()) {
    if (key.startsWith(`${projectName}:`)) {
      checkpoints.delete(key);
      deleted++;
    }
  }
  
  if (deleted > 0) {
    saveCheckpoints(checkpoints);
  }
  
  return deleted;
}

module.exports = {
  createCheckpoint,
  restoreCheckpoint,
  getCheckpoints,
  deleteCheckpoint,
  clearProjectCheckpoints
};