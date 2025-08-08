import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = path.join(__dirname, 'auth.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

// Create database connection
const db = new Database(DB_PATH);
console.log('Connected to SQLite database');

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash) => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      const result = stmt.run(username, passwordHash);
      return { id: result.lastInsertRowid, username };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Update last login time
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      throw err;
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  }
};

// Session database operations
const sessionDb = {
  // Get or create session with auto-execute setting
  getOrCreateSession: (sessionId, projectName) => {
    try {
      // First try to get existing session
      let session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      
      if (!session) {
        // Create new session if doesn't exist
        db.prepare('INSERT INTO sessions (id, project_name, auto_execute_pretasks) VALUES (?, ?, 0)').run(sessionId, projectName);
        session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      }
      
      return session;
    } catch (err) {
      throw err;
    }
  },

  // Update session auto-execute setting
  updateAutoExecute: (sessionId, autoExecute) => {
    try {
      const stmt = db.prepare('UPDATE sessions SET auto_execute_pretasks = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      const result = stmt.run(autoExecute ? 1 : 0, sessionId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Get session by ID
  getSession: (sessionId) => {
    try {
      return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    } catch (err) {
      throw err;
    }
  }
};

// PRETASK database operations
const pretaskDb = {
  // Get all pretasks for a session, ordered by order_index
  getSessionPretasks: (sessionId) => {
    try {
      return db.prepare('SELECT * FROM pretasks WHERE session_id = ? AND is_completed = 0 ORDER BY order_index ASC').all(sessionId);
    } catch (err) {
      throw err;
    }
  },

  // Add a new pretask
  addPretask: (sessionId, content) => {
    try {
      // Get the next order index
      const maxOrderResult = db.prepare('SELECT MAX(order_index) as max_order FROM pretasks WHERE session_id = ?').get(sessionId);
      const nextOrder = (maxOrderResult.max_order || 0) + 1;

      const stmt = db.prepare('INSERT INTO pretasks (session_id, content, order_index) VALUES (?, ?, ?)');
      const result = stmt.run(sessionId, content, nextOrder);
      
      // Return the created pretask
      return db.prepare('SELECT * FROM pretasks WHERE id = ?').get(result.lastInsertRowid);
    } catch (err) {
      throw err;
    }
  },

  // Delete a pretask
  deletePretask: (pretaskId) => {
    try {
      const stmt = db.prepare('DELETE FROM pretasks WHERE id = ?');
      const result = stmt.run(pretaskId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Update pretask order
  updatePretaskOrder: (sessionId, pretaskOrders) => {
    try {
      const stmt = db.prepare('UPDATE pretasks SET order_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?');
      
      db.transaction(() => {
        pretaskOrders.forEach(({ id, order_index }) => {
          stmt.run(order_index, id, sessionId);
        });
      })();

      return true;
    } catch (err) {
      throw err;
    }
  },

  // Mark pretask as completed
  markPretaskCompleted: (pretaskId) => {
    try {
      const stmt = db.prepare('UPDATE pretasks SET is_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      const result = stmt.run(pretaskId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Get next incomplete pretask for auto-execution
  getNextPretask: (sessionId) => {
    try {
      return db.prepare('SELECT * FROM pretasks WHERE session_id = ? AND is_completed = 0 ORDER BY order_index ASC LIMIT 1').get(sessionId);
    } catch (err) {
      throw err;
    }
  },

  // Get pretask by ID
  getPretask: (pretaskId) => {
    try {
      return db.prepare('SELECT * FROM pretasks WHERE id = ?').get(pretaskId);
    } catch (err) {
      throw err;
    }
  }
};

export {
  db,
  initializeDatabase,
  userDb,
  sessionDb,
  pretaskDb
};