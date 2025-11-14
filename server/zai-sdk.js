/**
 * Zai SDK Integration
 *
 * This module provides integration with Zai API using Anthropic-compatible endpoints.
 * It mirrors the interface of claude-sdk.js for consistency and easy provider switching.
 *
 * Key features:
 * - API-based integration with configurable endpoint
 * - Session management with abort capability
 * - Options mapping compatible with Claude SDK format
 * - WebSocket message streaming
 */

import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Session tracking: Map of session IDs to active sessions
const activeSessions = new Map();

// Configure Zai client with environment variables
const zaiClient = new Anthropic({
  apiKey: process.env.ZAI_API_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ZAI_BASE_URL || 'https://api.zai.com/v1' // Default Zai endpoint
});

/**
 * Maps CLI options to Zai-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} Zai-compatible options
 */
function mapCliOptionsToZai(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode, images } = options;

  const zaiOptions = {
    maxTokens: 4096,
    temperature: 0.7
  };

  // Map working directory
  if (cwd) {
    zaiOptions.cwd = cwd;
  }

  // Map model (default to sonnet-equivalent)
  zaiOptions.model = options.model || process.env.ZAI_MODEL || 'claude-sonnet-4-20250514';

  // Map permission mode
  if (permissionMode) {
    zaiOptions.permissionMode = permissionMode;
  }

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  zaiOptions.toolSettings = settings;

  // Map resume session
  if (sessionId) {
    zaiOptions.sessionId = sessionId;
  }

  return zaiOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} controller - AbortController for cancellation
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, controller, tempImagePaths = [], tempDir = null) {
  activeSessions.set(sessionId, {
    controller,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Handles image processing for Zai queries
 * @param {string} command - Original user prompt
 * @param {Array} images - Array of image objects with base64 data
 * @param {string} cwd - Working directory for temp file creation
 * @returns {Promise<Object>} {modifiedCommand, imageContent, tempImagePaths, tempDir}
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;
  const imageContent = [];

  if (!images || images.length === 0) {
    return { modifiedCommand: command, imageContent, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Process each image
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const extension = mimeType.split('/')[1] || 'png';
      const filename = `image_${index}.${extension}`;
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);

      // Add image to content for API
      imageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: base64Data
        }
      });
    }

    console.log(`📸 [Zai] Processed ${tempImagePaths.length} images`);
    return { modifiedCommand: command, imageContent, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for Zai:', error);
    return { modifiedCommand: command, imageContent, tempImagePaths, tempDir };
  }
}

/**
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    console.log(`🧹 [Zai] Cleaned up ${tempImagePaths.length} temp image files`);
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Generates a unique session ID
 * @returns {string} Session ID
 */
function generateSessionId() {
  return `zai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Executes a Zai query
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryZaiSDK(command, options = {}, ws) {
  const { sessionId } = options;
  let capturedSessionId = sessionId || generateSessionId();
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  const controller = new AbortController();

  try {
    // Map CLI options to Zai format
    const zaiOptions = mapCliOptionsToZai(options);

    // Handle images
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    // Track the session for abort capability
    addSession(capturedSessionId, controller, tempImagePaths, tempDir);

    // Build message content
    const content = [];
    if (finalCommand && finalCommand.trim()) {
      content.push({
        type: 'text',
        text: finalCommand
      });
    }
    // Add images if any
    content.push(...imageResult.imageContent);

    // Send session-created event for new sessions
    if (!sessionId && !sessionCreatedSent) {
      sessionCreatedSent = true;
      ws.send(JSON.stringify({
        type: 'session-created',
        sessionId: capturedSessionId
      }));
    }

    // Make API request with streaming
    console.log(`🔄 [Zai] Starting query for session: ${capturedSessionId}`);

    const stream = await zaiClient.messages.create({
      model: zaiOptions.model,
      max_tokens: zaiOptions.maxTokens,
      temperature: zaiOptions.temperature,
      messages: [{ role: 'user', content }],
      stream: true
    }, {
      signal: controller.signal
    });

    let accumulatedText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    // Process streaming response
    for await (const event of stream) {
      if (event.type === 'message_start') {
        // Handle message start
        ws.send(JSON.stringify({
          type: 'claude-response',
          data: {
            type: 'thinking_start',
            thinking: true
          }
        }));
      } else if (event.type === 'content_block_delta') {
        // Handle content deltas
        if (event.delta?.type === 'text_delta') {
          accumulatedText += event.delta.text;
          ws.send(JSON.stringify({
            type: 'claude-response',
            data: {
              type: 'text',
              text: event.delta.text
            }
          }));
        }
      } else if (event.type === 'message_delta') {
        // Handle usage updates
        if (event.usage) {
          outputTokens = event.usage.output_tokens || 0;
        }
      } else if (event.type === 'message_stop') {
        // Message complete
        console.log('✅ [Zai] Message complete');
      }
    }

    // Send token budget update
    const contextWindow = parseInt(process.env.CONTEXT_WINDOW) || 160000;
    const totalUsed = inputTokens + outputTokens;

    ws.send(JSON.stringify({
      type: 'token-budget',
      data: {
        used: totalUsed,
        total: contextWindow
      }
    }));

    // Clean up session on completion
    removeSession(capturedSessionId);

    // Clean up temporary image files
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Send completion event
    console.log('✅ [Zai] Streaming complete, sending completion event');
    ws.send(JSON.stringify({
      type: 'claude-complete',
      sessionId: capturedSessionId,
      exitCode: 0,
      isNewSession: !sessionId && !!command
    }));

  } catch (error) {
    console.error('[Zai] Query error:', error);

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files on error
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Send error to WebSocket
    ws.send(JSON.stringify({
      type: 'claude-error',
      error: error.message
    }));

    throw error;
  }
}

/**
 * Aborts an active Zai session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortZaiSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`[Zai] Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`🛑 [Zai] Aborting session: ${sessionId}`);

    // Abort the request
    session.controller.abort();

    // Update session status
    session.status = 'aborted';

    // Clean up temporary image files
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`[Zai] Error aborting session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Checks if a Zai session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isZaiSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active Zai session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveZaiSDKSessions() {
  return getAllSessions();
}

// Export public API
export {
  queryZaiSDK,
  abortZaiSDKSession,
  isZaiSDKSessionActive,
  getActiveZaiSDKSessions
};
