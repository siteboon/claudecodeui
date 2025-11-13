// Database operations and schema testing
import Database from 'better-sqlite3';
import { setupTestDatabase, seedTestDatabase, cleanupTestDatabase } from './database.js';

describe('Database Operations and Schema', () => {
  let db;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('Database Schema', () => {
    test('should create required tables', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const tableNames = tables.map(t => t.name);

      expect(tableNames).toContain('users');
      expect(tableNames).toContain('api_keys');
      expect(tableNames).toContain('user_credentials');
    });

    test('should have correct users table structure', () => {
      const schema = db.prepare("PRAGMA table_info(users)").all();

      const requiredColumns = ['id', 'username', 'email', 'password_hash', 'created_at', 'updated_at'];
      const columnNames = schema.map(col => col.name);

      requiredColumns.forEach(column => {
        expect(columnNames).toContain(column);
      });

      // Check constraints
      const idColumn = schema.find(col => col.name === 'id');
      expect(idColumn.pk).toBe(1); // Primary key
      expect(idColumn.type).toBe('INTEGER');

      const usernameColumn = schema.find(col => col.name === 'username');
      expect(usernameColumn.notnull).toBe(1); // Not null
      expect(usernameColumn.type).toBe('TEXT');
    });

    test('should have correct api_keys table structure', () => {
      const schema = db.prepare("PRAGMA table_info(api_keys)").all();

      const requiredColumns = ['id', 'user_id', 'key_name', 'api_key', 'created_at'];
      const columnNames = schema.map(col => col.name);

      requiredColumns.forEach(column => {
        expect(columnNames).toContain(column);
      });

      // Check foreign key constraint
      const userIdColumn = schema.find(col => col.name === 'user_id');
      expect(userIdColumn.notnull).toBe(1); // Not null

      const apiKeyColumn = schema.find(col => col.name === 'api_key');
      expect(apiKeyColumn.notnull).toBe(1); // Not null
    });

    test('should have correct user_credentials table structure', () => {
      const schema = db.prepare("PRAGMA table_info(user_credentials)").all();

      const requiredColumns = ['id', 'user_id', 'service_name', 'credential_data', 'created_at', 'updated_at'];
      const columnNames = schema.map(col => col.name);

      requiredColumns.forEach(column => {
        expect(columnNames).toContain(column);
      });

      const serviceColumn = schema.find(col => col.name === 'service_name');
      expect(serviceColumn.notnull).toBe(1); // Not null

      const dataColumn = schema.find(col => col.name === 'credential_data');
      expect(dataColumn.notnull).toBe(1); // Not null
    });

    test('should enable foreign keys', () => {
      const result = db.prepare("PRAGMA foreign_keys").get();
      expect(result.foreign_keys).toBe(1);
    });
  });

  describe('CRUD Operations', () => {
    let testData;

    beforeEach(async () => {
      testData = await seedTestDatabase();
    });

    describe('Users Table Operations', () => {
      test('should create new user', () => {
        const insertUser = db.prepare(`
          INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
        `);

        const result = insertUser.run('newuser', 'newuser@example.com', 'hashedpassword123');
        expect(result.changes).toBe(1);
        expect(result.lastInsertRowid).toBeTruthy();

        const user = db.prepare('SELECT * FROM users WHERE username = ?').get('newuser');
        expect(user).toBeDefined();
        expect(user.username).toBe('newuser');
        expect(user.email).toBe('newuser@example.com');
      });

      test('should read user by ID', () => {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(testData.userId);

        expect(user).toBeDefined();
        expect(user.id).toBe(testData.userId);
        expect(user.username).toBe('testuser');
        expect(user.email).toBe('test@example.com');
      });

      test('should update user', () => {
        const updateUser = db.prepare(`
          UPDATE users SET email = ? WHERE id = ?
        `);

        const result = updateUser.run('updated@example.com', testData.userId);
        expect(result.changes).toBe(1);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(testData.userId);
        expect(user.email).toBe('updated@example.com');
      });

      test('should delete user and related records', () => {
        // First delete related API keys
        const deleteApiKeys = db.prepare('DELETE FROM api_keys WHERE user_id = ?');
        deleteApiKeys.run(testData.userId);

        // Delete related credentials
        const deleteCredentials = db.prepare('DELETE FROM user_credentials WHERE user_id = ?');
        deleteCredentials.run(testData.userId);

        // Now delete the user
        const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');
        const result = deleteUser.run(testData.userId);
        expect(result.changes).toBe(1);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(testData.userId);
        expect(user).toBeUndefined();
      });
    });

    describe('API Keys Table Operations', () => {
      test('should create new API key', () => {
        const insertApiKey = db.prepare(`
          INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)
        `);

        const result = insertApiKey.run(testData.userId, 'production-key', 'prod-key-12345');
        expect(result.changes).toBe(1);

        const apiKey = db.prepare('SELECT * FROM api_keys WHERE api_key = ?').get('prod-key-12345');
        expect(apiKey).toBeDefined();
        expect(apiKey.key_name).toBe('production-key');
      });

      test('should read API key by key value', () => {
        const apiKey = db.prepare('SELECT * FROM api_keys WHERE api_key = ?').get('test-api-key-12345');

        expect(apiKey).toBeDefined();
        expect(apiKey.key_name).toBe('test-key');
        expect(apiKey.user_id).toBe(testData.userId);
      });

      test('should update API key', () => {
        const updateApiKey = db.prepare(`
          UPDATE api_keys SET key_name = ? WHERE id = ?
        `);

        const result = updateApiKey.run('updated-key', 1);
        expect(result.changes).toBe(1);

        const apiKey = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(1);
        expect(apiKey.key_name).toBe('updated-key');
      });

      test('should delete API key', () => {
        const deleteApiKey = db.prepare('DELETE FROM api_keys WHERE id = ?');

        const result = deleteApiKey.run(1);
        expect(result.changes).toBe(1);

        const apiKey = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(1);
        expect(apiKey).toBeUndefined();
      });
    });

    describe('User Credentials Table Operations', () => {
      test('should create new user credential', () => {
        const credentialData = JSON.stringify({
          accessToken: 'ghp_1234567890',
          refreshToken: 'ref_1234567890'
        });

        const insertCredential = db.prepare(`
          INSERT INTO user_credentials (user_id, service_name, credential_data) VALUES (?, ?, ?)
        `);

        const result = insertCredential.run(
          testData.userId,
          'github',
          credentialData
        );
        expect(result.changes).toBe(1);

        const credential = db.prepare('SELECT * FROM user_credentials WHERE service_name = ?')
          .get('github');
        expect(credential).toBeDefined();
        expect(credential.service_name).toBe('github');
        expect(JSON.parse(credential.credential_data).accessToken).toBe('ghp_1234567890');
      });

      test('should read user credentials by service', () => {
        // First create a credential
        const credentialData = JSON.stringify({ token: 'gitlab-token-123' });
        db.prepare(`
          INSERT INTO user_credentials (user_id, service_name, credential_data) VALUES (?, ?, ?)
        `).run(testData.userId, 'gitlab', credentialData);

        const credential = db.prepare('SELECT * FROM user_credentials WHERE service_name = ? AND user_id = ?')
          .get('gitlab', testData.userId);

        expect(credential).toBeDefined();
        expect(credential.service_name).toBe('gitlab');
        expect(JSON.parse(credential.credential_data).token).toBe('gitlab-token-123');
      });

      test('should update user credentials', () => {
        // First create a credential
        const credentialData = JSON.stringify({ token: 'old-token' });
        const insertResult = db.prepare(`
          INSERT INTO user_credentials (user_id, service_name, credential_data) VALUES (?, ?, ?)
        `).run(testData.userId, 'bitbucket', credentialData);

        // Update it
        const newCredentialData = JSON.stringify({ token: 'new-token', refreshToken: 'refresh-123' });
        const updateCredential = db.prepare(`
          UPDATE user_credentials SET credential_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `);

        const result = updateCredential.run(newCredentialData, insertResult.lastInsertRowid);
        expect(result.changes).toBe(1);

        const credential = db.prepare('SELECT * FROM user_credentials WHERE id = ?')
          .get(insertResult.lastInsertRowid);
        const parsedData = JSON.parse(credential.credential_data);
        expect(parsedData.token).toBe('new-token');
        expect(parsedData.refreshToken).toBe('refresh-123');
      });
    });
  });

  describe('Data Integrity and Constraints', () => {
    test('should enforce unique constraint on username', () => {
      const insertUser = db.prepare(`
        INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
      `);

      // Insert first user
      insertUser.run('duplicateuser', 'user1@example.com', 'password1');

      // Try to insert second user with same username
      expect(() => {
        insertUser.run('duplicateuser', 'user2@example.com', 'password2');
      }).toThrow();
    });

    test('should enforce unique constraint on email', () => {
      const insertUser = db.prepare(`
        INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
      `);

      // Insert first user
      insertUser.run('user1', 'duplicate@example.com', 'password1');

      // Try to insert second user with same email
      expect(() => {
        insertUser.run('user2', 'duplicate@example.com', 'password2');
      }).toThrow();
    });

    test('should enforce foreign key constraint on api_keys', () => {
      const insertApiKey = db.prepare(`
        INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)
      `);

      // Try to insert API key for non-existent user
      expect(() => {
        insertApiKey.run(999, 'invalid-key', 'key-123');
      }).toThrow();
    });

    test('should enforce not null constraints', () => {
      const insertUser = db.prepare(`
        INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
      `);

      // Try to insert user without username
      expect(() => {
        insertUser.run(null, 'test@example.com', 'password');
      }).toThrow();

      // Try to insert user without email
      expect(() => {
        insertUser.run('testuser', null, 'password');
      }).toThrow();
    });
  });

  describe('Query Performance', () => {
    beforeEach(async () => {
      // Insert test data for performance testing
      const insertUser = db.prepare(`
        INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
      `);

      const insertApiKey = db.prepare(`
        INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)
      `);

      // Insert 100 users
      for (let i = 0; i < 100; i++) {
        const result = insertUser.run(`user${i}`, `user${i}@example.com`, `hashed${i}`);

        // Insert 3 API keys per user
        for (let j = 0; j < 3; j++) {
          insertApiKey.run(result.lastInsertRowid, `key-${j}`, `key-${i}-${j}`);
        }
      }
    });

    test('should query users efficiently by ID', () => {
      const startTime = Date.now();

      for (let i = 1; i <= 100; i++) {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(i);
        expect(user).toBeDefined();
      }

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should complete in under 100ms for 100 queries
      expect(executionTime).toBeLessThan(100);
    });

    test('should query API keys efficiently', () => {
      const startTime = Date.now();

      const allApiKeys = db.prepare('SELECT * FROM api_keys WHERE user_id <= 50').all();
      expect(allApiKeys).toHaveLength(150); // 50 users * 3 keys each

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should complete in under 50ms
      expect(executionTime).toBeLessThan(50);
    });

    test('should handle complex joins efficiently', () => {
      const startTime = Date.now();

      const result = db.prepare(`
        SELECT u.username, COUNT(ak.id) as key_count
        FROM users u
        LEFT JOIN api_keys ak ON u.id = ak.user_id
        WHERE u.id <= 50
        GROUP BY u.id, u.username
        ORDER BY u.id
      `).all();

      expect(result).toHaveLength(50);
      result.forEach(row => {
        expect(row.key_count).toBe(3); // Each user has 3 keys
      });

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should complete in under 100ms
      expect(executionTime).toBeLessThan(100);
    });
  });

  describe('Transaction Handling', () => {
    test('should commit successful transaction', () => {
      const transaction = db.transaction(() => {
        const insertUser = db.prepare(`
          INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
        `);

        const result = insertUser.run('transactionuser', 'trans@example.com', 'password');

        const insertApiKey = db.prepare(`
          INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)
        `);

        insertApiKey.run(result.lastInsertRowid, 'trans-key', 'trans-key-123');

        return result.lastInsertRowid;
      });

      const userId = transaction();

      // Verify both records were inserted
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      expect(user).toBeDefined();

      const apiKey = db.prepare('SELECT * FROM api_keys WHERE user_id = ?').all(userId);
      expect(apiKey).toHaveLength(1);
    });

    test('should rollback failed transaction', () => {
      const failingTransaction = db.transaction(() => {
        const insertUser = db.prepare(`
          INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)
        `);

        const result = insertUser.run('rollbackuser', 'rollback@example.com', 'password');

        // Try to insert duplicate username to trigger rollback
        insertUser.run('rollbackuser', 'duplicate@example.com', 'password');

        return result.lastInsertRowid;
      });

      expect(() => {
        failingTransaction();
      }).toThrow();

      // Verify no records were inserted
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get('rollbackuser');
      expect(user).toBeUndefined();
    });
  });
});