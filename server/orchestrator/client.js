/**
 * OrchestratorClient
 *
 * WebSocket client that connects claudecodeui to a central orchestrator server.
 * Handles connection management, authentication, heartbeats, and message routing.
 */

import { EventEmitter } from "events";
import WebSocket from "ws";
import os from "os";
import { userDb } from "../database/db.js";
import { generateToken } from "../middleware/auth.js";
import {
  createRegisterMessage,
  createStatusUpdateMessage,
  createPingMessage,
  createResponseChunkMessage,
  createResponseCompleteMessage,
  createErrorMessage,
  createHttpProxyResponseMessage,
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
   * @param {string} [config.callbackUrl] - HTTP callback URL for proxying (e.g., http://localhost:3010)
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
      callbackUrl: config.callbackUrl || null,
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
        // Build connection URL with client_id for hibernation-aware tagging
        const connectionUrl = new URL(this.config.url);
        connectionUrl.searchParams.set("client_id", this.config.clientId);
        const urlString = connectionUrl.toString();

        console.log(
          `[ORCHESTRATOR] Connecting to ${urlString} as ${this.config.clientId}`,
        );
        this.ws = new WebSocket(urlString);

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
      // Include callback URL for HTTP proxy support
      // This allows the orchestrator to proxy HTTP requests to this instance
      callback_url: this.config.callbackUrl || null,
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

    // Clear any existing heartbeat timeout before setting a new one
    // This prevents stale timers from firing on healthy connections
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }

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

      case InboundMessageTypes.HTTP_PROXY_REQUEST:
        this.handleHttpProxyRequest(message);
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
   * Handles HTTP proxy request from orchestrator
   * Makes a local HTTP request and sends the response back
   * @param {Object} message - HTTP proxy request message
   */
  async handleHttpProxyRequest(message) {
    const { request_id, method, path, headers, body, query, proxy_base } =
      message;
    console.log(`[ORCHESTRATOR] HTTP proxy request: ${method} ${path}`);

    try {
      // Extract orchestrator user info from headers for auto-authentication
      let orchestratorUserId = null;
      let orchestratorUsername = null;

      if (headers && Array.isArray(headers)) {
        for (const [key, value] of headers) {
          if (key.toLowerCase() === "x-orchestrator-user-id") {
            orchestratorUserId = value;
          } else if (key.toLowerCase() === "x-orchestrator-username") {
            orchestratorUsername = value;
          }
        }
      }

      // If we have orchestrator user info, generate a token for auto-authentication
      let orchestratorToken = null;
      if (orchestratorUserId && orchestratorUsername) {
        try {
          orchestratorToken = await this.getOrCreateOrchestratorToken(
            orchestratorUserId,
            orchestratorUsername,
          );
        } catch (err) {
          console.error(
            "[ORCHESTRATOR] Failed to create orchestrator token:",
            err,
          );
        }
      }

      // Build the local URL - use the configured local server port
      const port = process.env.PORT || 3010;
      let url = `http://localhost:${port}${path}`;
      if (query) {
        url += `?${query}`;
      }

      // Build fetch options
      const fetchOptions = {
        method: method || "GET",
        headers: {},
      };

      // Add headers (skip orchestrator-specific headers and authorization)
      // We'll set our own Authorization header if we have an orchestrator token
      if (headers && Array.isArray(headers)) {
        for (const [key, value] of headers) {
          const keyLower = key.toLowerCase();
          // Skip host header, orchestrator headers, and authorization (we'll set it ourselves)
          if (
            keyLower !== "host" &&
            keyLower !== "authorization" &&
            !keyLower.startsWith("x-orchestrator-")
          ) {
            fetchOptions.headers[key] = value;
          }
        }
      }

      // If we have an orchestrator token, add it as Authorization header
      // This auto-authenticates the request to claudecodeui
      // We always skip the original Authorization header to avoid case-sensitivity issues
      if (orchestratorToken) {
        // Validate token format before setting (should have 3 parts separated by dots)
        const tokenParts = orchestratorToken.split(".");
        if (tokenParts.length !== 3) {
          console.error(
            `[ORCHESTRATOR] Invalid token format - expected 3 parts, got ${tokenParts.length}`,
          );
        } else {
          fetchOptions.headers["authorization"] = `Bearer ${orchestratorToken}`;
          console.log(
            `[ORCHESTRATOR] Setting auth header for user: ${orchestratorUsername || "[unknown]"} (token: [REDACTED])`,
          );
        }
      }

      // Add body for non-GET/HEAD requests
      if (body && method !== "GET" && method !== "HEAD") {
        fetchOptions.body = body;
      }

      // Make the local HTTP request
      const response = await fetch(url, fetchOptions);

      // Collect response headers
      const responseHeaders = [];
      let contentType = "";
      response.headers.forEach((value, key) => {
        responseHeaders.push([key, value]);
        if (key.toLowerCase() === "content-type") {
          contentType = value;
        }
      });

      // Determine if content is binary based on content-type
      // Text types: text/*, application/json, application/javascript, application/xml, etc. with utf-8
      const isTextContent =
        contentType.startsWith("text/") ||
        contentType.includes("application/json") ||
        contentType.includes("application/javascript") ||
        contentType.includes("application/xml") ||
        contentType.includes("utf-8");

      // Get response body - use arrayBuffer for binary, text for text content
      let responseBody;
      if (isTextContent) {
        responseBody = await response.text();
      } else {
        // Binary content - read as arrayBuffer and base64 encode
        const arrayBuffer = await response.arrayBuffer();
        responseBody = Buffer.from(arrayBuffer).toString("base64");
        responseHeaders.push(["x-orch-encoding", "base64"]);
      }

      // Rewrite URLs if proxy_base is provided and content type is HTML or JavaScript
      let didRewrite = false;
      if (proxy_base) {
        if (contentType.includes("text/html")) {
          console.log(
            `[ORCHESTRATOR] Rewriting HTML URLs with proxy_base: ${proxy_base}`,
          );
          responseBody = this.rewriteHtmlUrls(
            responseBody,
            proxy_base,
            orchestratorToken,
            orchestratorUsername,
          );
          didRewrite = true;
        } else if (contentType.includes("javascript")) {
          console.log(
            `[ORCHESTRATOR] Rewriting JS URLs with proxy_base: ${proxy_base} (content-type: ${contentType})`,
          );
          responseBody = this.rewriteJsUrls(responseBody, proxy_base);
          didRewrite = true;
        }
      }

      // If we rewrote content, adjust headers for proper caching behavior
      // - Remove Content-Length since body size changed
      // - Modify Cache-Control to use must-revalidate instead of immutable
      //   This allows Cloudflare to cache but revalidate periodically
      let finalHeaders = responseHeaders;
      if (didRewrite) {
        finalHeaders = responseHeaders
          .filter(([key]) => key.toLowerCase() !== "content-length")
          .map(([key, value]) => {
            // Modify Cache-Control for rewritten assets
            // Replace immutable with must-revalidate and cap max-age to 1 hour
            if (
              key.toLowerCase() === "cache-control" &&
              value.includes("immutable")
            ) {
              // Change "public, max-age=31536000, immutable" to
              // "public, max-age=3600, must-revalidate" (1 hour)
              const newValue = value
                .replace(/immutable/gi, "must-revalidate")
                .replace(/max-age=\d+/i, "max-age=3600");
              console.log(
                `[ORCHESTRATOR] Modified Cache-Control: ${value} -> ${newValue}`,
              );
              return [key, newValue];
            }
            return [key, value];
          });
      }

      // Send the response back to orchestrator
      const proxyResponse = createHttpProxyResponseMessage(
        request_id,
        response.status,
        finalHeaders,
        responseBody,
      );
      this.sendMessage(proxyResponse);

      console.log(
        `[ORCHESTRATOR] HTTP proxy response: ${response.status} (${responseBody.length} bytes)`,
      );
    } catch (error) {
      console.error("[ORCHESTRATOR] HTTP proxy request failed:", error.message);

      // Send error response
      const errorResponse = createHttpProxyResponseMessage(
        request_id,
        502,
        [["Content-Type", "application/json"]],
        JSON.stringify({ error: `Proxy request failed: ${error.message}` }),
      );
      this.sendMessage(errorResponse);
    }
  }

  /**
   * Rewrites absolute URLs in HTML content to go through the proxy
   * @param {string} html - HTML content
   * @param {string} proxyBase - Base proxy path (e.g., "/clients/{id}/proxy")
   * @param {string|null} orchestratorToken - Optional JWT token for auto-authentication
   * @param {string|null} orchestratorUsername - Optional username for token matching
   * @returns {string} HTML with rewritten URLs
   */
  rewriteHtmlUrls(
    html,
    proxyBase,
    orchestratorToken = null,
    orchestratorUsername = null,
  ) {
    // Add a cache-busting version to force fresh fetches from Cloudflare edge
    // Using a static version that should be incremented when URL rewriting logic changes
    const cacheVersion = "v3"; // Increment this when rewriting logic changes

    let result = html
      .replace(/src="\/(?!\/)/g, `src="${proxyBase}/`)
      .replace(/href="\/(?!\/)/g, `href="${proxyBase}/`)
      .replace(/action="\/(?!\/)/g, `action="${proxyBase}/`)
      .replace(/src='\/(?!\/)/g, `src='${proxyBase}/`)
      .replace(/href='\/(?!\/)/g, `href='${proxyBase}/`)
      .replace(/action='\/(?!\/)/g, `action='${proxyBase}/`)
      // Handle service worker registration: pass proxyBase as query param
      // e.g., register('/sw.js') -> register('/clients/.../proxy/sw.js?proxyBase=/clients/.../proxy')
      .replace(
        /\.register\('\/sw\.js'\)/g,
        `.register('${proxyBase}/sw.js?proxyBase=${encodeURIComponent(proxyBase)}')`,
      )
      .replace(
        /\.register\("\/sw\.js"\)/g,
        `.register("${proxyBase}/sw.js?proxyBase=${encodeURIComponent(proxyBase)}")`,
      );

    // Add cache-busting parameter to JS and CSS asset URLs
    // Match patterns like src="/clients/.../proxy/assets/file.js" or href="/clients/.../proxy/assets/file.css"
    result = result.replace(
      /(<script[^>]+src="[^"]+\.js)(")/g,
      `$1?_=${cacheVersion}$2`,
    );
    result = result.replace(
      /(<link[^>]+href="[^"]+\.css)(")/g,
      `$1?_=${cacheVersion}$2`,
    );

    // Inject scripts to:
    // 1. Auto-authenticate via orchestrator token
    // 2. Patch fetch() to redirect API calls through the proxy
    //
    // Note: React app uses 'auth-token' as the localStorage key
    // We need to check if the existing token belongs to the same orchestrator user.
    // If not, we update the token. We also store the orchestrator username separately
    // to detect user changes without decoding the JWT on every request.
    const proxyPatchScript = `<script>
// Patch fetch and WebSocket to redirect through the proxy
(function() {
  const proxyBase = "${proxyBase}";

  // Make proxyBase available globally for React app components
  window.__ORCHESTRATOR_PROXY_BASE__ = proxyBase;

  const originalFetch = window.fetch;

  window.fetch = function(url, options) {
    // Convert URL to string if it's a Request object
    let urlStr = url instanceof Request ? url.url : String(url);

    // If it's an absolute path (starts with /) but not a full URL (no protocol)
    // and not already going through the proxy, redirect it
    if (urlStr.startsWith('/') && !urlStr.startsWith('//') && !urlStr.startsWith(proxyBase)) {
      const newUrl = proxyBase + urlStr;
      console.log('[ORCHESTRATOR] Redirecting fetch:', urlStr, '->', newUrl);

      if (url instanceof Request) {
        // Create a new Request with the modified URL
        url = new Request(newUrl, url);
      } else {
        url = newUrl;
      }
    }

    return originalFetch.call(this, url, options);
  };

  console.log('[ORCHESTRATOR] Fetch patched for proxy base:', proxyBase);
})();
</script>`;

    const authScript = orchestratorToken
      ? `<script>
// Auto-authenticate via orchestrator token
(function() {
  const existingToken = localStorage.getItem('auth-token');
  const storedOrchestratorUser = localStorage.getItem('orchestrator-user');
  const orchestratorUsername = "${orchestratorUsername || ""}";

  // Check if we need to update the token:
  // 1. No existing token
  // 2. Orchestrator user changed (different GitHub user accessing via proxy)
  // 3. Token exists but no stored orchestrator user (legacy direct login token)
  const needsUpdate = !existingToken ||
    (orchestratorUsername && storedOrchestratorUser !== orchestratorUsername) ||
    (existingToken && !storedOrchestratorUser && orchestratorUsername);

  if (needsUpdate) {
    const token = "${orchestratorToken}";
    localStorage.setItem('auth-token', token);
    if (orchestratorUsername) {
      localStorage.setItem('orchestrator-user', orchestratorUsername);
    }
    console.log('[ORCHESTRATOR] Auto-authenticated via orchestrator proxy for user:', orchestratorUsername || 'unknown');
    // Reload the page so the app initializes with the token
    window.location.reload();
    return;
  }
  console.log('[ORCHESTRATOR] Already have valid auth token for user:', storedOrchestratorUser);
})();
</script>`
      : "";

    // Inject both scripts right after the opening <head> tag
    // Proxy patch must come first so fetch is patched before any other scripts run
    result = result.replace(
      /<head>/i,
      `<head>${proxyPatchScript}${authScript}`,
    );

    return result;
  }

  /**
   * Rewrites absolute URLs in JavaScript content to go through the proxy
   * @param {string} js - JavaScript content
   * @param {string} proxyBase - Base proxy path (e.g., "/clients/{id}/proxy")
   * @returns {string} JavaScript with rewritten URLs
   */
  rewriteJsUrls(js, proxyBase) {
    // Only rewrite specific path prefixes that are likely URLs, not regex patterns
    // This is more selective than matching all "/" to avoid breaking regex literals
    const urlPrefixes = [
      "api",
      "assets",
      "auth",
      "ws",
      "favicon",
      "static",
      "socket.io",
      "sw.js",
      "manifest.json",
      "icons",
    ];

    let result = js;
    for (const prefix of urlPrefixes) {
      // Escape regex metacharacters in the prefix to match literal characters
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match "/${prefix}, '/${prefix}, `/${prefix} patterns
      result = result
        .replace(
          new RegExp(`"\\/${escapedPrefix}(?=[\\/"])`, "g"),
          `"${proxyBase}/${prefix}`,
        )
        .replace(
          new RegExp(`'\\/${escapedPrefix}(?=[\\/'])`, "g"),
          `'${proxyBase}/${prefix}`,
        )
        .replace(
          new RegExp(`\`\\/${escapedPrefix}(?=[\\/\`])`, "g"),
          `\`${proxyBase}/${prefix}`,
        );
    }

    return result;
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

  /**
   * Gets or creates a JWT token for an orchestrator-authenticated user
   * This enables seamless authentication when accessing claudecodeui through the orchestrator proxy
   * @param {string} githubId - GitHub user ID from orchestrator
   * @param {string} githubUsername - GitHub username from orchestrator
   * @returns {string} JWT token for the user
   */
  async getOrCreateOrchestratorToken(githubId, githubUsername) {
    // Get or create the user in the local database
    const user = userDb.getOrCreateOrchestratorUser(githubId, githubUsername);

    // Generate a JWT token for this user
    const token = generateToken(user);

    console.log(
      `[ORCHESTRATOR] Generated token for orchestrator user: ${githubUsername} (GitHub ID: ${githubId})`,
    );

    return token;
  }
}

export default OrchestratorClient;
