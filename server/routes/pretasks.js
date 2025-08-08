import express from 'express';
import { sessionDb, pretaskDb } from '../database/db.js';

const router = express.Router();

// Helper function to validate session exists and get project info
async function validateSession(sessionId) {
  // For now, we'll create sessions on-demand since they come from Claude CLI
  // In a real implementation, you might want to validate against actual session files
  return sessionId && typeof sessionId === 'string' && sessionId.length > 0;
}

// Get all pretasks for a session
router.get('/sessions/:sessionId/pretasks', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!await validateSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get or create session record
    const session = sessionDb.getOrCreateSession(sessionId, ''); // Project name will be set when needed
    
    // Get pretasks for the session
    const pretasks = pretaskDb.getSessionPretasks(sessionId);
    
    res.json({
      session_id: sessionId,
      auto_execute: session.auto_execute_pretasks === 1,
      pretasks: pretasks
    });
  } catch (error) {
    console.error('Error getting pretasks:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a new pretask
router.post('/sessions/:sessionId/pretasks', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { content, project_name } = req.body;
    
    if (!await validateSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required and must be a non-empty string' });
    }

    // Get or create session record
    const session = sessionDb.getOrCreateSession(sessionId, project_name || '');
    
    // Add the pretask
    const pretask = pretaskDb.addPretask(sessionId, content.trim());
    
    res.json({
      success: true,
      pretask: pretask
    });
  } catch (error) {
    console.error('Error adding pretask:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a pretask
router.delete('/sessions/:sessionId/pretasks/:pretaskId', async (req, res) => {
  try {
    const { sessionId, pretaskId } = req.params;
    
    if (!await validateSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify pretask belongs to session
    const pretask = pretaskDb.getPretask(pretaskId);
    if (!pretask) {
      return res.status(404).json({ error: 'Pretask not found' });
    }

    if (pretask.session_id !== sessionId) {
      return res.status(403).json({ error: 'Pretask does not belong to this session' });
    }

    // Delete the pretask
    const success = pretaskDb.deletePretask(pretaskId);
    
    if (!success) {
      return res.status(404).json({ error: 'Pretask not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting pretask:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update pretask order
router.put('/sessions/:sessionId/pretasks/order', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { pretasks } = req.body;
    
    if (!await validateSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!Array.isArray(pretasks)) {
      return res.status(400).json({ error: 'Pretasks must be an array' });
    }

    // Validate pretasks array format
    for (const item of pretasks) {
      if (!item.id || typeof item.order_index !== 'number') {
        return res.status(400).json({ error: 'Each pretask must have id and order_index' });
      }
    }

    // Update the order
    const success = pretaskDb.updatePretaskOrder(sessionId, pretasks);
    
    if (!success) {
      return res.status(400).json({ error: 'Failed to update pretask order' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating pretask order:', error);
    res.status(500).json({ error: error.message });
  }
});

// Toggle auto-execute setting
router.put('/sessions/:sessionId/auto-execute', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { auto_execute } = req.body;
    
    if (!await validateSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (typeof auto_execute !== 'boolean') {
      return res.status(400).json({ error: 'auto_execute must be a boolean' });
    }

    // Get or create session record and update auto-execute
    sessionDb.getOrCreateSession(sessionId, '');
    const success = sessionDb.updateAutoExecute(sessionId, auto_execute);
    
    if (!success) {
      return res.status(400).json({ error: 'Failed to update auto-execute setting' });
    }

    res.json({ 
      success: true, 
      auto_execute: auto_execute 
    });
  } catch (error) {
    console.error('Error updating auto-execute setting:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get next pretask for execution (internal use)
router.get('/sessions/:sessionId/pretasks/next', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!await validateSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionDb.getSession(sessionId);
    if (!session || session.auto_execute_pretasks !== 1) {
      return res.json({ 
        has_next: false, 
        auto_execute: false,
        message: 'Auto-execute is disabled' 
      });
    }

    const nextPretask = pretaskDb.getNextPretask(sessionId);
    
    if (!nextPretask) {
      return res.json({ 
        has_next: false, 
        auto_execute: true,
        message: 'No pending pretasks' 
      });
    }

    res.json({
      has_next: true,
      auto_execute: true,
      pretask: nextPretask
    });
  } catch (error) {
    console.error('Error getting next pretask:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark pretask as completed (internal use)
router.put('/sessions/:sessionId/pretasks/:pretaskId/complete', async (req, res) => {
  try {
    const { sessionId, pretaskId } = req.params;
    
    if (!await validateSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify pretask belongs to session
    const pretask = pretaskDb.getPretask(pretaskId);
    if (!pretask) {
      return res.status(404).json({ error: 'Pretask not found' });
    }

    if (pretask.session_id !== sessionId) {
      return res.status(403).json({ error: 'Pretask does not belong to this session' });
    }

    // Mark as completed
    const success = pretaskDb.markPretaskCompleted(pretaskId);
    
    if (!success) {
      return res.status(400).json({ error: 'Failed to mark pretask as completed' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error completing pretask:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;