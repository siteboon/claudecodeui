const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'auth.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

// Create database connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Initialize database with schema
const initializeDatabase = async () => {
  return new Promise((resolve, reject) => {
    try {
      const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
      db.exec(initSQL, (err) => {
        if (err) {
          console.error('Error initializing database:', err.message);
          reject(err);
        } else {
          console.log('Database initialized successfully');
          resolve();
        }
      });
    } catch (error) {
      console.error('Error reading init SQL file:', error);
      reject(error);
    }
  });
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    return new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) reject(err);
        else resolve(row.count > 0);
      });
    });
  },

  // Create a new user
  createUser: (username, passwordHash) => {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      stmt.run(username, passwordHash, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, username });
        }
      });
      stmt.finalize();
    });
  },

  // Get user by username
  getUserByUsername: (username) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  // Update last login time
  updateLastLogin: (userId) => {
    return new Promise((resolve, reject) => {
      db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [userId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },

  // Get user by ID
  getUserById: (userId) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT id, username, created_at, last_login FROM users WHERE id = ? AND is_active = 1', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
};

module.exports = {
  db,
  initializeDatabase,
  userDb
};