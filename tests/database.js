// Database testing utilities
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class TestDatabase {
  constructor() {
    this.db = null;
  }

  async setup() {
    // Create in-memory database for testing
    this.db = new Database(':memory:');

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Create tables based on your schema
    this.createTables();

    return this.db;
  }

  createTables() {
    // Users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // API keys table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        key_name TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // User credentials table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        service_name TEXT NOT NULL,
        credential_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);
  }

  async seedTestData() {
    // Insert test user
    const insertUser = this.db.prepare(`
      INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
    `);

    const result = insertUser.run('testuser', 'test@example.com', 'hashedpassword');

    // Insert test API key
    const insertApiKey = this.db.prepare(`
      INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)
    `);

    insertApiKey.run(result.lastInsertRowid, 'test-key', 'test-api-key-12345');

    return {
      userId: result.lastInsertRowid,
      username: 'testuser',
      email: 'test@example.com'
    };
  }

  async cleanup() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Helper methods for testing
  getUser(userId) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(userId);
  }

  getApiKey(key) {
    const stmt = this.db.prepare('SELECT * FROM api_keys WHERE api_key = ?');
    return stmt.get(key);
  }

  getAllUsers() {
    const stmt = this.db.prepare('SELECT * FROM users');
    return stmt.all();
  }
}

// Export singleton instance
const testDb = new TestDatabase();

// Jest hooks for database setup/teardown
export const setupTestDatabase = async () => {
  return await testDb.setup();
};

export const seedTestDatabase = async () => {
  return await testDb.seedTestData();
};

export const cleanupTestDatabase = async () => {
  await testDb.cleanup();
};

export default testDb;