import express from 'express';
import { spawnCodegen, abortCodegenSession, getActiveCodegenSessions, sendInputToCodegenSession } from '../codegen-cli.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Start a new Codegen session
router.post('/start', authenticateToken, async (req, res) => {
  try {
    const { command, projectPath, cwd, toolsSettings, permissionMode, images } = req.body;
    
    console.log('Starting Codegen session with:', {
      command: command?.substring(0, 100) + '...',
      projectPath,
      cwd,
      toolsSettings,
      permissionMode,
      imageCount: images?.length || 0
    });
    
    // Start Codegen process
    const result = await spawnCodegen(command, {
      projectPath,
      cwd,
      toolsSettings,
      permissionMode,
      images
    });
    
    res.json({
      success: true,
      sessionId: result.sessionId,
      output: result.output,
      isSessionActive: result.isSessionActive
    });
  } catch (error) {
    console.error('Error starting Codegen session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Resume an existing Codegen session
router.post('/resume', authenticateToken, async (req, res) => {
  try {
    const { sessionId, command, projectPath, cwd, toolsSettings } = req.body;
    
    console.log('Resuming Codegen session:', sessionId);
    
    const result = await spawnCodegen(command, {
      sessionId,
      projectPath,
      cwd,
      resume: true,
      toolsSettings
    });
    
    res.json({
      success: true,
      sessionId: result.sessionId,
      output: result.output,
      isSessionActive: result.isSessionActive
    });
  } catch (error) {
    console.error('Error resuming Codegen session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send input to an active Codegen session
router.post('/input', authenticateToken, async (req, res) => {
  try {
    const { sessionId, input } = req.body;
    
    if (!sessionId || !input) {
      return res.status(400).json({
        success: false,
        error: 'Session ID and input are required'
      });
    }
    
    const success = sendInputToCodegenSession(sessionId, input);
    
    res.json({
      success,
      message: success ? 'Input sent successfully' : 'Session not found or not active'
    });
  } catch (error) {
    console.error('Error sending input to Codegen session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Abort a Codegen session
router.post('/abort', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      });
    }
    
    const success = abortCodegenSession(sessionId);
    
    res.json({
      success,
      message: success ? 'Session aborted successfully' : 'Session not found'
    });
  } catch (error) {
    console.error('Error aborting Codegen session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get active Codegen sessions
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const activeSessions = getActiveCodegenSessions();
    
    res.json({
      success: true,
      sessions: activeSessions
    });
  } catch (error) {
    console.error('Error getting active Codegen sessions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check Codegen CLI availability
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const { spawn } = await import('child_process');
    const codegenPath = process.env.CODEGEN_CLI_PATH || 'codegen';
    
    // Try to run codegen --version to check if it's available
    const child = spawn(codegenPath, ['--version'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = '';
    let error = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        res.json({
          success: true,
          available: true,
          version: output.trim(),
          path: codegenPath
        });
      } else {
        res.json({
          success: true,
          available: false,
          error: error.trim() || 'Codegen CLI not found',
          path: codegenPath
        });
      }
    });
    
    child.on('error', (err) => {
      res.json({
        success: true,
        available: false,
        error: err.message,
        path: codegenPath
      });
    });
  } catch (error) {
    console.error('Error checking Codegen status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get Codegen configuration
router.get('/config', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        cliPath: process.env.CODEGEN_CLI_PATH || 'codegen',
        sessionTimeout: parseInt(process.env.CODEGEN_SESSION_TIMEOUT) || 3600000,
        maxSessions: parseInt(process.env.CODEGEN_MAX_SESSIONS) || 10,
        memoryLimit: parseInt(process.env.MEMORY_LIMIT) || 512,
        cpuLimit: parseInt(process.env.CPU_LIMIT) || 2
      }
    });
  } catch (error) {
    console.error('Error getting Codegen config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
