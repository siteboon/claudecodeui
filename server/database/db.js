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
  createUser: (username, passwordHash, isPamUser = false) => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash, is_pam_user) VALUES (?, ?, ?)');
      const result = stmt.run(username, passwordHash, isPamUser ? 1 : 0);
      return { id: result.lastInsertRowid, username, is_pam_user: isPamUser };
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
      const row = db.prepare('SELECT id, username, created_at, last_login, is_pam_user FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Update user PAM status
  updateUserPamStatus: (userId, isPamUser) => {
    try {
      const stmt = db.prepare('UPDATE users SET is_pam_user = ? WHERE id = ?');
      stmt.run(isPamUser ? 1 : 0, userId);
    } catch (err) {
      throw err;
    }
  },

  // Check if user is PAM user
  isPamUser: (userId) => {
    try {
      const row = db.prepare('SELECT is_pam_user FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row ? row.is_pam_user === 1 : false;
    } catch (err) {
      throw err;
    }
  }
};

export {
  db,
  initializeDatabase,
  userDb
};