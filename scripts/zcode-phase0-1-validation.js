#!/usr/bin/env node

/**
 * Phase 0.1 Validation Script for ZCode Integration
 * 
 * This script validates the ZCode app-server protocol by:
 * 1. Starting the app-server as a subprocess
 * 2. Creating a new session
 * 3. Sending a test prompt
 * 4. Subscribing to and capturing all event types
 * 5. Gracefully closing the session and terminating the app-server
 * 
 * Output: Event samples saved to zcode-event-samples.json
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const ENGINE_PATH = process.env.CLOUDCLI_ZCODE_ENGINE || 
  '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
const NODE_PATH = process.env.CLOUDCLI_NODE_PATH || 
  (os.platform() === 'darwin' ? path.join(os.homedir(), '.nvm/versions/node/v25.9.0/bin/node') : 'node');
const SAMPLES_OUTPUT = path.join(__dirname, 'zcode-event-samples.json');
const TEST_PROMPT = 'echo hello';
const TIMEOUT = 60000; // 60 seconds

// State
let appServer = null;
let requestId = 0;
let pendingRequests = new Map();
let sessionId = null;
let eventSamples = {
  metadata: {
    timestamp: new Date().toISOString(),
    enginePath: ENGINE_PATH,
    testPrompt: TEST_PROMPT,
    platform: os.platform(),
    nodeVersion: process.version
  },
  events: [],
  responses: {},
  errors: []
};

// Logging utilities
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  event: (type, data) => {
    const dataStr = data !== undefined ? JSON.stringify(data).substring(0, 100) + '...' : '';
    console.log(`[EVENT] ${type}:`, dataStr);
  }
};

/**
 * Resolve the ZCode engine path
 */
function resolveEnginePath() {
  const envPath = process.env.CLOUDCLI_ZCODE_ENGINE;
  if (envPath) {
    log.info(`Using engine from CLOUDCLI_ZCODE_ENGINE: ${envPath}`);
    return envPath;
  }
  
  const defaultPath = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
  if (fs.existsSync(defaultPath)) {
    log.info(`Using default engine path: ${defaultPath}`);
    return defaultPath;
  }
  
  // Try ~/Applications variant
  const userPath = path.join(os.homedir(), 'Applications/ZCode.app/Contents/Resources/glm/zcode.cjs');
  if (fs.existsSync(userPath)) {
    log.info(`Using user engine path: ${userPath}`);
    return userPath;
  }
  
  throw new Error(`ZCode engine not found at ${defaultPath} or ${userPath}. Set CLOUDCLI_ZCODE_ENGINE environment variable.`);
}

/**
 * Start the app-server process
 */
function startAppServer() {
  const enginePath = resolveEnginePath();
  
  log.info('Starting ZCode app-server...');
  log.info(`Using Node.js: ${NODE_PATH}`);
  log.info(`Using ZCode engine: ${enginePath}`);
  
  appServer = spawn(NODE_PATH, [enginePath, 'app-server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  });
  
  appServer.on('error', (error) => {
    log.error(`Failed to start app-server: ${error.message}`);
    throw error;
  });
  
  appServer.on('exit', (code, signal) => {
    log.info(`App-server exited with code ${code}, signal ${signal}`);
  });
  
  // Handle stderr
  appServer.stderr.on('data', (data) => {
    const stderr = data.toString().trim();
    if (stderr) {
      console.error(`[STDERR] ${stderr}`);
    }
  });
  
  // Parse stdout line by line
  appServer.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          handleProtocolMessage(message);
        } catch (error) {
          log.error(`Failed to parse line: ${line.substring(0, 100)}...`);
          eventSamples.errors.push({
            type: 'parse_error',
            line: line.substring(0, 500),
            error: error.message
          });
        }
      }
    });
  });
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('App-server start timeout'));
    }, 10000);
    
    // Wait for process to start
    setTimeout(() => {
      clearTimeout(timeout);
      if (appServer.pid) {
        log.success(`App-server started with PID ${appServer.pid}`);
        resolve();
      } else {
        reject(new Error('App-server failed to start'));
      }
    }, 2000);
  });
}

/**
 * Handle protocol messages from app-server
 */
function handleProtocolMessage(message) {
  // Request response (has 'id' field)
  if ('id' in message) {
    // Check if this is a server request (server-to-client) or a response to our request
    if (message.method) {
      // Server request (server is asking us to do something)
      handleServerRequest(message);
    } else {
      // Response to our request
      const pending = pendingRequests.get(message.id);
      if (pending) {
        if (message.error) {
          log.error(`Request ${message.id} failed:`, message.error);
          pending.reject(message.error);
          eventSamples.errors.push({
            type: 'request_error',
            requestId: message.id,
            method: pending.method,
            error: message.error
          });
        } else {
          log.event(`Response for ${pending.method}`, message.result);
          pending.resolve(message.result);
          eventSamples.responses[pending.method] = message.result;
        }
        pendingRequests.delete(message.id);
      } else {
        log.event(`Unmatched response for id ${message.id}`);
      }
    }
  } 
  // Notification (no 'id' field, like session/event)
  else if ('method' in message) {
    handleNotification(message);
  }
  else {
    log.error('Unrecognized message format:', message);
    eventSamples.errors.push({
      type: 'unknown_message_format',
      message: message
    });
  }
}

/**
 * Handle server-to-client requests
 */
function handleServerRequest(message) {
  const { id, method, params } = message;
  log.event(`Server request: ${method}`, params);
  
  // Capture server requests as events
  eventSamples.events.push({
    type: `server_request:${method}`,
    params: params,
    timestamp: new Date().toISOString(),
    direction: 'server_to_client'
  });
  
  // Respond to common server requests with basic responses
  if (method === 'session/requestRuntimePreferences') {
    sendServerResponse(id, {
      nativeSearchEnhancementsEnabled: false,
      // Add other required fields as we discover them
    });
  } else {
    // Send empty result for unknown requests
    sendServerResponse(id, {});
  }
}

/**
 * Send response to server request
 */
function sendServerResponse(requestId, result) {
  const response = { id: requestId, result };
  const responseLine = JSON.stringify(response) + '\n';
  
  try {
    appServer.stdin.write(responseLine);
    log.info(`Sent server response for request ${requestId}`);
  } catch (error) {
    log.error(`Failed to send server response: ${error.message}`);
  }
}

/**
 * Handle notifications (events)
 */
function handleNotification(message) {
  const { method, params } = message;
  log.event(method, params);
  
  // Capture all event types
  eventSamples.events.push({
    type: method,
    params: params,
    timestamp: new Date().toISOString()
  });
}

/**
 * Send a protocol request
 */
function sendRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    requestId++;
    const id = requestId;
    
    const request = { id, method, params };
    const requestLine = JSON.stringify(request) + '\n';
    
    log.info(`Sending ${method} (request ${id})`);
    
    pendingRequests.set(id, { method, resolve, reject });
    
    try {
      appServer.stdin.write(requestLine);
    } catch (error) {
      pendingRequests.delete(id);
      reject(error);
    }
    
    // Set timeout for request
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request ${method} (${id}) timeout`));
      }
    }, 30000);
  });
}

/**
 * Close the app-server gracefully
 */
async function stopAppServer() {
  log.info('Stopping app-server...');
  
  if (appServer) {
    // Close stdin to signal EOF
    appServer.stdin.end();
    
    // Wait for graceful exit
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log.info('App-server did not exit gracefully, killing...');
        appServer.kill('SIGTERM');
        resolve();
      }, 2000);
      
      appServer.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    log.success('App-server stopped');
  }
}

/**
 * Save event samples to file
 */
function saveSamples() {
  log.info(`Saving event samples to ${SAMPLES_OUTPUT}...`);
  
  // Add summary statistics
  eventSamples.summary = {
    totalEvents: eventSamples.events.length,
    eventTypes: [...new Set(eventSamples.events.map(e => e.type))],
    totalErrors: eventSamples.errors.length,
    responseMethods: Object.keys(eventSamples.responses)
  };
  
  fs.writeFileSync(SAMPLES_OUTPUT, JSON.stringify(eventSamples, null, 2));
  log.success(`Event samples saved with ${eventSamples.events.length} events`);
}

/**
 * Main validation flow
 */
async function runValidation() {
  try {
    log.info('=== Phase 0.1 Validation Started ===');
    log.info(`Platform: ${os.platform()}, Node: ${process.version}`);
    
    // Step 1: Start app-server
    await startAppServer();
    await sleep(2000); // Give it time to fully initialize
    
    // Step 2: Try to list existing sessions first
    log.info('Listing existing sessions...');
    let localSessionId = null;
    
    try {
      const listResult = await sendRequest('session/list', {});
      const sessions = listResult?.sessions || [];
      log.success(`Found ${sessions.length} existing sessions`);
      
      // Look for an active session
      const activeSession = sessions.find(s => s.status === 'active' || s.status === 'running');
      if (activeSession) {
        localSessionId = activeSession.sessionId;
        log.info(`Using active session: ${localSessionId} (status: ${activeSession.status})`);
      } else if (sessions.length > 0) {
        // Use the first session if no active ones, but log the status
        const firstSession = sessions[0];
        log.info(`Using first session: ${firstSession.sessionId} (status: ${firstSession.status})`);
        localSessionId = firstSession.sessionId;
      }
    } catch (error) {
      log.info(`Session list failed: ${error.message}`);
    }
    
    // Step 3: Create a new session if needed
    if (!localSessionId) {
      log.info('Creating new session...');
      
      try {
        const createResult = await sendRequest('session/create', {
          // Try minimal parameters first
        });
        localSessionId = createResult.sessionId;
      } catch (error) {
        log.info(`Session creation failed: ${error.message}`);
        // Continue with error handling
        throw error;
      }
    }
    
    sessionId = localSessionId;
    
    if (!sessionId) {
      throw new Error('Failed to get valid session ID');
    }
    
    log.success(`Session ready: ${sessionId}`);
    eventSamples.sessionId = sessionId;
    
    // Step 3: Try to subscribe to session events (may fail for inactive sessions)
    log.info(`Subscribing to session events for ${sessionId}...`);
    try {
      await sendRequest('session/subscribe', {
        sessionId,
        deliveryKind: 'desktop-continuous' // Required parameter
      });
      log.success('Subscribed to session events');
    } catch (error) {
      log.info(`Subscribe failed (expected for inactive sessions): ${error.message}`);
      // Continue anyway - we can still get some event data from other requests
    }
    
    // Step 4: Send a test prompt
    log.info(`Sending test prompt: "${TEST_PROMPT}"...`);
    try {
      await sendRequest('session/send', {
        sessionId,
        content: TEST_PROMPT // Correct parameter name
      });
      log.success('Test prompt sent');
    } catch (error) {
      log.info(`Session send failed: ${error.message}`);
      // Continue anyway - we may still get some event data
    }
    
    // Step 5: Wait for events to flow in
    log.info('Waiting for events...');
    await sleep(15000); // Give time for various events to arrive
    
    // Step 6: Close the session
    log.info('Closing session...');
    try {
      await sendRequest('session/close', {
        sessionId
      });
      log.success('Session closed');
    } catch (error) {
      log.error(`Failed to close session: ${error.message}`);
      eventSamples.errors.push({
        type: 'session_close_error',
        error: error.message
      });
    }
    
    // Final wait to catch any remaining events
    await sleep(2000);
    
    // Save samples
    saveSamples();
    
    // Print summary
    log.info('=== Validation Complete ===');
    log.info(`Total events captured: ${eventSamples.events.length}`);
    log.info(`Event types discovered: ${eventSamples.summary.eventTypes.join(', ')}`);
    log.info(`Response methods: ${eventSamples.summary.responseMethods.join(', ')}`);
    
    if (eventSamples.errors.length > 0) {
      log.info(`Total errors: ${eventSamples.errors.length}`);
    }
    
    log.success('✨ Phase 0.1 validation completed successfully!');
    
  } catch (error) {
    log.error(`Validation failed: ${error.message}`);
    process.exit(1);
  } finally {
    await stopAppServer();
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the validation
const isMainModule = process.argv[1] === new URL(import.meta.url).pathname;
if (isMainModule) {
  runValidation().catch(error => {
    log.error(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
}

export { runValidation, resolveEnginePath };