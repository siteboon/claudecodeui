import { sessionDb, pretaskDb } from './database/db.js';
import { spawnClaude } from './claude-cli.js';

/**
 * PRETASK Manager - Handles auto-execution of pretasks
 * 
 * This module monitors task completion events and automatically executes
 * the next pretask in queue when:
 * 1. A task completes successfully
 * 2. The session has auto-execute enabled
 * 3. There are pending pretasks in the queue
 */
class PretaskManager {
  constructor() {
    this.executingPretasks = new Map(); // Track currently executing pretasks by session
  }

  /**
   * Check and execute next pretask for a session
   * Called when a task completes
   */
  async checkAndExecuteNext(sessionId, projectPath, cwd, ws) {
    try {
      console.log('🔄 PretaskManager: Checking for next pretask in session:', sessionId);

      // Prevent concurrent executions for the same session
      if (this.executingPretasks.has(sessionId)) {
        console.log('⏳ PretaskManager: Already executing pretask for session:', sessionId);
        return;
      }

      // Get session info
      const session = sessionDb.getSession(sessionId);
      if (!session || session.auto_execute_pretasks !== 1) {
        console.log('🚫 PretaskManager: Auto-execute disabled for session:', sessionId);
        return;
      }

      // Get next pretask
      const nextPretask = pretaskDb.getNextPretask(sessionId);
      if (!nextPretask) {
        console.log('✅ PretaskManager: No more pretasks in queue for session:', sessionId);
        this.notifyPretaskQueueEmpty(ws, sessionId);
        return;
      }

      console.log('🚀 PretaskManager: Executing pretask:', nextPretask.id, 'Content:', nextPretask.content);

      // Mark as executing
      this.executingPretasks.set(sessionId, nextPretask.id);

      // Notify frontend that pretask execution is starting
      this.notifyPretaskStart(ws, sessionId, nextPretask);

      try {
        // Execute the pretask using Claude CLI
        await this.executePretask(nextPretask, sessionId, projectPath, cwd, ws);

        // Mark pretask as completed
        pretaskDb.markPretaskCompleted(nextPretask.id);
        console.log('✅ PretaskManager: Pretask completed:', nextPretask.id);

        // Notify frontend of completion
        this.notifyPretaskComplete(ws, sessionId, nextPretask);

        // Remove from executing map
        this.executingPretasks.delete(sessionId);

        // Note: Don't recursively call checkAndExecuteNext here
        // The completion of this pretask will trigger another claude-complete event
        // which will naturally call this function again for the next pretask

      } catch (error) {
        console.error('❌ PretaskManager: Error executing pretask:', nextPretask.id, error);
        
        // Notify frontend of error
        this.notifyPretaskError(ws, sessionId, nextPretask, error);
        
        // Remove from executing map
        this.executingPretasks.delete(sessionId);
        
        // Don't continue execution on error - let user decide what to do
      }

    } catch (error) {
      console.error('❌ PretaskManager: Error in checkAndExecuteNext:', error);
      this.executingPretasks.delete(sessionId);
    }
  }

  /**
   * Execute a single pretask
   */
  async executePretask(pretask, sessionId, projectPath, cwd, ws) {
    const options = {
      sessionId: sessionId,
      projectPath: projectPath,
      cwd: cwd,
      resume: true, // Resume the existing session
      toolsSettings: {
        allowedTools: [], // Use default tools or get from session settings
        disallowedTools: [],
        skipPermissions: false
      }
    };

    // Execute the pretask content as a command
    await spawnClaude(pretask.content, options, ws);
  }

  /**
   * Stop auto-execution for a session (when user manually interacts)
   */
  stopAutoExecution(sessionId) {
    if (this.executingPretasks.has(sessionId)) {
      console.log('🛑 PretaskManager: Stopping auto-execution for session:', sessionId);
      this.executingPretasks.delete(sessionId);
    }
  }

  /**
   * Check if session is currently auto-executing pretasks
   */
  isAutoExecuting(sessionId) {
    return this.executingPretasks.has(sessionId);
  }

  // Notification methods for WebSocket communication
  
  notifyPretaskStart(ws, sessionId, pretask) {
    ws.send(JSON.stringify({
      type: 'pretask-start',
      sessionId: sessionId,
      pretask: {
        id: pretask.id,
        content: pretask.content,
        order_index: pretask.order_index
      }
    }));
  }

  notifyPretaskComplete(ws, sessionId, pretask) {
    ws.send(JSON.stringify({
      type: 'pretask-complete',
      sessionId: sessionId,
      pretask: {
        id: pretask.id,
        content: pretask.content,
        order_index: pretask.order_index
      }
    }));
  }

  notifyPretaskError(ws, sessionId, pretask, error) {
    ws.send(JSON.stringify({
      type: 'pretask-error',
      sessionId: sessionId,
      pretask: {
        id: pretask.id,
        content: pretask.content,
        order_index: pretask.order_index
      },
      error: error.message
    }));
  }

  notifyPretaskQueueEmpty(ws, sessionId) {
    ws.send(JSON.stringify({
      type: 'pretask-queue-empty',
      sessionId: sessionId
    }));
  }
}

// Export singleton instance
export const pretaskManager = new PretaskManager();