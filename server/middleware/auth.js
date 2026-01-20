import jwt from "jsonwebtoken";
import crypto from "crypto";
import { userDb } from "../database/db.js";

// Get JWT secret from environment or use default (for development)
const JWT_SECRET =
  process.env.JWT_SECRET || "claude-ui-dev-secret-change-in-production";

// Debug: Log secret hash on module load to verify same secret is used across imports
const secretHash = crypto
  .createHash("sha256")
  .update(JWT_SECRET)
  .digest("hex")
  .substring(0, 8);
const AUTH_DEBUG = process.env.AUTH_DEBUG === "true";
if (AUTH_DEBUG) {
  console.log(`[AUTH] Module loaded - JWT_SECRET hash: ${secretHash}`);
}

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }

  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode:  use single database user
  if (process.env.VITE_IS_PLATFORM === "true") {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res
          .status(500)
          .json({ error: "Platform mode: No user found in database" });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error("Platform mode error:", error);
      return res
        .status(500)
        .json({ error: "Platform mode: Failed to fetch user" });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    // Debug: Log token details before verification (only when AUTH_DEBUG is enabled)
    if (AUTH_DEBUG) {
      console.log(
        `[AUTH] Verifying token (first 20 chars): ${token.substring(0, 20)}...`,
      );
      console.log(`[AUTH] Using JWT_SECRET hash: ${secretHash}`);

      // Decode without verification to see the payload
      const unverified = jwt.decode(token);
      console.log(
        `[AUTH] Token payload (unverified):`,
        JSON.stringify(unverified),
      );
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (AUTH_DEBUG) {
      console.log(
        `[AUTH] Token verified successfully for user: ${decoded.username}`,
      );
    }

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: "Invalid token. User not found." });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error(`[AUTH] Token verification error: ${error.message}`);
    if (AUTH_DEBUG) {
      console.error(
        `[AUTH] Token (first 50 chars): ${token.substring(0, 50)}...`,
      );
      console.error(`[AUTH] JWT_SECRET hash: ${secretHash}`);
    }
    return res.status(403).json({ error: "Invalid token" });
  }
};

// Generate JWT token (never expires)
const generateToken = (user) => {
  const token = jwt.sign(
    {
      userId: user.id,
      username: user.username,
    },
    JWT_SECRET,
    // No expiration - token lasts forever
  );
  if (AUTH_DEBUG) {
    console.log(
      `[AUTH] Generated token for user ${user.username} (id: ${user.id})`,
    );
    console.log(`[AUTH] Token (first 20 chars): ${token.substring(0, 20)}...`);
    console.log(`[AUTH] Using JWT_SECRET hash: ${secretHash}`);
  }
  return token;
};

// WebSocket authentication function
const authenticateWebSocket = (token) => {
  // Platform mode: bypass token validation, return first user
  if (process.env.VITE_IS_PLATFORM === "true") {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error("Platform mode WebSocket error:", error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    console.error("WebSocket token verification error:", error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET,
};
