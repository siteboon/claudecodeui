/**
 * OrchestratorClient
 *
 * WebSocket client that connects claudecodeui to a central orchestrator server.
 * Handles connection management, authentication, heartbeats, and message routing.
 */

import { EventEmitter } from "events";
import WebSocket from "ws";
import os from "os";
import {
  createRegisterMessage,
  createStatusUpdateMessage,
  createPingMessage,
  createResponseChunkMessage,
  createResponseCompleteMessage,
  createErrorMessage,
  serialize,
  parse,
  validateInboundMessage,
  InboundMessageTypes,
  StatusValues,
  CommandTypes,
} from "./protocol.js";

/**
 * Default configuration values
 */
const DEFAULTS = {
  reconnectInterval: 5000,
  heartbeatInterval: 30000,
  heartbeatTimeout: 10000,
  maxReconnectAttempts: 10,
  reconnectBackoffMultiplier: 1.5,
  maxReconnectInterval: 60000,
};

/**
 * OrchestratorClient class
 *
 * Manages the WebSocket connection to the orchestrator server.
 * Emits events: 'connected', 'disconnected', 'error', 'command', 'user_request'
 */
export class OrchestratorClient extends EventEmitter {
  /**
   * Creates a new OrchestratorClient
   * @param {Object} config - Configuration options
   * @param {string} config.url - Orchestrator WebSocket URL
   * @param {string} config.token - Authentication token
   * @param {string} [config.clientId] - Custom client ID (defaults to hostname-pid)
   * @param {number} [config.reconnectInterval] - Base reconnect interval in ms
   * @param {number} [config.heartbeatInterval] - Heartbeat interval in ms
   * @param {Object} [config.metadata] - Additional metadata to send on register
   */
  constructor(config) {
    super();

    if (!config.url) {
      throw new Error("Orchestrator URL is required");
    }
    if (!config.token) {
      throw new Error("Orchestrator token is required");
    }

    this.config = {
      url: config.url,
      token: config.token,
      clientId: config.clientId || `${os.hostname()}-${process.pid}`,
      reconnectInterval: config.reconnectInterval || DEFAULTS.reconnectInterval,
      heartbeatInterval: config.heartbeatInterval || DEFAULTS.heartbeatInterval,
      maxReconnectAttempts:
        config.maxReconnectAttempts || DEFAULTS.maxReconnectAttempts,
      metadata: config.metadata || {},
    };

    this.ws = null;
    this.status = StatusValues.IDLE;
    this.reconnectAttempts = 0;
    this.currentReconnectInterval = this.config.reconnectInterval;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatTimeoutTimer = null;
    this.isConnected = false;
    this.isRegistered = false;
    this.shouldReconnect = true;
  }

  /**
   * Connects to the orchestrator server
   * @returns {Promise<void>} Resolves when connected and registered
   */
  async connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.shouldReconnect = true;

      try {
        console.log(
          `[ORCHESTRATOR] Connecting to ${this.config.url} as ${this.config.clientId}`,
        );
        this.ws = new WebSocket(this.config.url);

        const connectTimeout = setTimeout(() => {
          if (!this.isConnected) {
            this.ws.terminate();
            reject(new Error("Connection timeout"));
          }
        }, 30000);

        this.ws.on("open", () => {
          clearTimeout(connectTimeout);
          console.log("[ORCHESTRATOR] WebSocket connection established");
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.currentReconnectInterval = this.config.reconnectInterval;

          // Send registration message
          this.sendRegister();
        });

        this.ws.on("message", (data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on("close", (code, reason) => {
          clearTimeout(connectTimeout);
          const wasConnected = this.isConnected;
          this.isConnected = false;
          this.isRegistered = false;
          this.stopHeartbeat();

          console.log(
            `[ORCHESTRATOR] Connection closed: ${code} ${reason || ""}`,
          );
          this.emit("disconnected", { code, reason: reason?.toString() });

          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }

          if (!wasConnected) {
            reject(new Error(`Connection failed: ${code}`));
          }
        });

        this.ws.on("error", (error) => {
          console.error("[ORCHESTRATOR] WebSocket error:", error.message);
          this.emit("error", error);
        });

        // Wait for registration before resolving
        const onRegistered = () => {
          clearTimeout(connectTimeout);
          resolve();
        };

        const onError = (error) => {
          clearTimeout(connectTimeout);
          this.removeListener("registered", onRegistered);
          reject(error);
        };

        this.once("registered", onRegistered);
        this.once("error", onError);
      } catch (error) {
        console.error("[ORCHESTRATOR] Connection error:", error.message);
        reject(error);
      }
    });
  }

  /**
   * Disconnects from the orchestrator server
   */
  disconnect() {
    console.log("[ORCHESTRATOR] Disconnecting...");
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.isConnected = false;
    this.isRegistered = false;
  }

  /**
   * Sends registration message to orchestrator
   */
  sendRegister() {
    const metadata = {
      hostname: os.hostname(),
      platform: os.platform(),
      project: process.cwd(),
      status: this.status,
      version: process.env.npm_package_version || "1.0.0",
      ...this.config.metadata,
    };

    const message = createRegisterMessage(
      this.config.clientId,
      this.config.token,
      metadata,
    );
    this.sendMessage(message);
  }

  /**
   * Sends a status update to the orchestrator
   * @param {string} status - New status (idle, active, busy)
   */
  sendStatusUpdate(status) {
    if (!Object.values(StatusValues).includes(status)) {
      console.warn(`[ORCHESTRATOR] Invalid status: ${status}`);
      return;
    }

    this.status = status;

    if (!this.isRegistered) {
      console.log(
        "[ORCHESTRATOR] Not registered, queuing status update:",
        status,
      );
      return;
    }

    const message = createStatusUpdateMessage(this.config.clientId, status);
    this.sendMessage(message);
  }

  /**
   * Sends a ping message for heartbeat
   */
  sendPing() {
    const message = createPingMessage(this.config.clientId);
    this.sendMessage(message);

    // Set timeout for pong response
    this.heartbeatTimeoutTimer = setTimeout(() => {
      console.warn("[ORCHESTRATOR] Heartbeat timeout, reconnecting...");
      this.ws?.terminate();
    }, DEFAULTS.heartbeatTimeout);
  }

  /**
   * Sends a response chunk for a proxied request
   * @param {string} requestId - Request ID
   * @param {Object} data - Chunk data
   */
  sendResponseChunk(requestId, data) {
    const message = createResponseChunkMessage(requestId, data);
    this.sendMessage(message);
  }

  /**
   * Sends a response complete message for a proxied request
   * @param {string} requestId - Request ID
   * @param {Object} [data] - Final data
   */
  sendResponseComplete(requestId, data = null) {
    const message = createResponseCompleteMessage(requestId, data);
    this.sendMessage(message);
  }

  /**
   * Sends an error message
   * @param {string} requestId - Request ID (optional)
   * @param {string} errorMessage - Error message
   */
  sendError(requestId, errorMessage) {
    const message = createErrorMessage(requestId, errorMessage);
    this.sendMessage(message);
  }

  /**
   * Sends a message to the orchestrator
   * @param {Object} message - Message object
   */
  sendMessage(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[ORCHESTRATOR] Cannot send message, not connected");
      return;
    }

    try {
      this.ws.send(serialize(message));
    } catch (error) {
      console.error("[ORCHESTRATOR] Failed to send message:", error.message);
    }
  }

  /**
   * Handles incoming messages from the orchestrator
   * @param {string} data - Raw message data
   */
  handleMessage(data) {
    const message = parse(data);
    if (!message) {
      return;
    }

    if (!validateInboundMessage(message)) {
      console.warn("[ORCHESTRATOR] Invalid message received:", message.type);
      return;
    }

    switch (message.type) {
      case InboundMessageTypes.REGISTERED:
        this.handleRegistered(message);
        break;

      case InboundMessageTypes.PONG:
        this.handlePong();
        break;

      case InboundMessageTypes.COMMAND:
        this.handleCommand(message);
        break;

      case InboundMessageTypes.ERROR:
        console.error("[ORCHESTRATOR] Error from server:", message.message);
        this.emit("error", new Error(message.message));
        break;

      case InboundMessageTypes.USER_REQUEST:
        this.handleUserRequest(message);
        break;

      default:
        console.log("[ORCHESTRATOR] Unknown message type:", message.type);
    }
  }

  /**
   * Handles registration response
   * @param {Object} message - Registration response message
   */
  handleRegistered(message) {
    if (message.success) {
      console.log("[ORCHESTRATOR] Successfully registered with orchestrator");
      this.isRegistered = true;
      this.startHeartbeat();
      this.emit("registered");
      this.emit("connected");

      // Send current status if not idle
      if (this.status !== StatusValues.IDLE) {
        this.sendStatusUpdate(this.status);
      }
    } else {
      console.error(
        "[ORCHESTRATOR] Registration failed:",
        message.message || "Unknown error",
      );
      this.emit("error", new Error(message.message || "Registration failed"));
      this.disconnect();
    }
  }

  /**
   * Handles pong response
   */
  handlePong() {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * Handles command from orchestrator
   * @param {Object} message - Command message
   */
  handleCommand(message) {
    console.log("[ORCHESTRATOR] Received command:", message.command);

    switch (message.command) {
      case CommandTypes.DISCONNECT:
        console.log("[ORCHESTRATOR] Server requested disconnect");
        this.shouldReconnect = false;
        this.disconnect();
        break;

      case CommandTypes.REFRESH_STATUS:
        this.sendStatusUpdate(this.status);
        break;

      default:
        this.emit("command", message);
    }
  }

  /**
   * Handles user request from orchestrator (proxy mode)
   * @param {Object} message - User request message
   */
  handleUserRequest(message) {
    console.log(
      "[ORCHESTRATOR] Received user request:",
      message.request_id,
      message.action,
    );
    this.emit("user_request", message);
  }

  /**
   * Starts the heartbeat interval
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, this.config.heartbeatInterval);
  }

  /**
   * Stops the heartbeat interval
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * Schedules a reconnection attempt with exponential backoff
   */
  scheduleReconnect() {
    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error("[ORCHESTRATOR] Max reconnect attempts reached, giving up");
      this.emit("error", new Error("Max reconnect attempts reached"));
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `[ORCHESTRATOR] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${this.currentReconnectInterval}ms`,
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error("[ORCHESTRATOR] Reconnect failed:", error.message);
      }
    }, this.currentReconnectInterval);

    // Exponential backoff
    this.currentReconnectInterval = Math.min(
      this.currentReconnectInterval * DEFAULTS.reconnectBackoffMultiplier,
      DEFAULTS.maxReconnectInterval,
    );
  }

  /**
   * Clears the reconnect timer
   */
  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Gets the current connection state
   * @returns {Object} Connection state
   */
  getState() {
    return {
      isConnected: this.isConnected,
      isRegistered: this.isRegistered,
      status: this.status,
      clientId: this.config.clientId,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

export default OrchestratorClient;
