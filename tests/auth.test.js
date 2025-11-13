// Authentication endpoints tests
import request from 'supertest';
import express from 'express';
import { setupTestDatabase, cleanupTestDatabase } from './database.js';
import { createMockApp } from './test-utils.js';
import authRoutes from '../server/routes/auth.js';

// Mock dependencies
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn()
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn()
}));

describe('Authentication Routes', () => {
  let app;
  let mockDb;
  let mockUserDb;
  let bcrypt = require('bcrypt');
  let jwt = require('jsonwebtoken');

  beforeEach(async () => {
    // Setup test database
    mockDb = await setupTestDatabase();

    // Mock database functions
    mockUserDb = {
      hasUsers: jest.fn().mockReturnValue(false),
      createUser: jest.fn().mockReturnValue({ id: 1, username: 'testuser' }),
      getUserByUsername: jest.fn(),
      getUserById: jest.fn().mockReturnValue({ id: 1, username: 'testuser' }),
      getFirstUser: jest.fn().mockReturnValue({ id: 1, username: 'testuser' }),
      updateLastLogin: jest.fn()
    };

    // Mock the database imports
    jest.doMock('../server/database/db.js', () => ({
      userDb: mockUserDb,
      db: mockDb
    }));

    // Reset all mocks
    jest.clearAllMocks();

    // Create Express app with auth routes
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('GET /api/auth/status', () => {
    test('should return auth status when no users exist', async () => {
      mockUserDb.hasUsers.mockReturnValue(false);

      const response = await request(app)
        .get('/api/auth/status')
        .expect(200);

      expect(response.body).toEqual({
        needsSetup: true,
        isAuthenticated: false
      });
    });

    test('should return auth status when users exist', async () => {
      mockUserDb.hasUsers.mockReturnValue(true);

      const response = await request(app)
        .get('/api/auth/status')
        .expect(200);

      expect(response.body).toEqual({
        needsSetup: false,
        isAuthenticated: false
      });
    });

    test('should handle database errors', async () => {
      mockUserDb.hasUsers.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app)
        .get('/api/auth/status')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Internal server error'
      });
    });
  });

  describe('POST /api/auth/register', () => {
    beforeEach(() => {
      bcrypt.hash.mockResolvedValue('hashedpassword');
      jwt.sign.mockReturnValue('mock-jwt-token');
    });

    test('should register a new user successfully', async () => {
      const userData = {
        username: 'testuser',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(200);

      expect(mockUserDb.hasUsers).toHaveBeenCalled();
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
      expect(mockUserDb.createUser).toHaveBeenCalledWith('testuser', 'hashedpassword');
      expect(jwt.sign).toHaveBeenCalled();
      expect(response.body).toEqual({
        success: true,
        user: { id: 1, username: 'testuser' },
        token: 'mock-jwt-token'
      });
    });

    test('should reject registration with missing username', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ password: 'password123' })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Username and password are required'
      });
    });

    test('should reject registration with missing password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser' })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Username and password are required'
      });
    });

    test('should reject registration with short username', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'ab', password: 'password123' })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Username must be at least 3 characters, password at least 6 characters'
      });
    });

    test('should reject registration with short password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: '12345' })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Username must be at least 3 characters, password at least 6 characters'
      });
    });

    test('should reject registration when user already exists', async () => {
      mockUserDb.hasUsers.mockReturnValue(true);

      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: 'password123' })
        .expect(403);

      expect(response.body).toEqual({
        error: 'User already exists. This is a single-user system.'
      });
    });

    test('should handle database constraint errors', async () => {
      mockUserDb.hasUsers.mockReturnValue(false);
      mockUserDb.createUser.mockImplementation(() => {
        const error = new Error('Constraint violation');
        error.code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw error;
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: 'password123' })
        .expect(409);

      expect(response.body).toEqual({
        error: 'Username already exists'
      });
    });

    test('should handle bcrypt hashing errors', async () => {
      bcrypt.hash.mockRejectedValue(new Error('Hashing error'));

      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: 'password123' })
        .expect(500);

      expect(response.body).toEqual({
        error: 'Internal server error'
      });
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(() => {
      bcrypt.compare.mockResolvedValue(true);
      jwt.sign.mockReturnValue('mock-jwt-token');
      mockUserDb.getUserByUsername.mockReturnValue({
        id: 1,
        username: 'testuser',
        password_hash: 'hashedpassword'
      });
    });

    test('should login user successfully', async () => {
      const loginData = {
        username: 'testuser',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(mockUserDb.getUserByUsername).toHaveBeenCalledWith('testuser');
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashedpassword');
      expect(jwt.sign).toHaveBeenCalled();
      expect(mockUserDb.updateLastLogin).toHaveBeenCalledWith(1);
      expect(response.body).toEqual({
        success: true,
        user: { id: 1, username: 'testuser' },
        token: 'mock-jwt-token'
      });
    });

    test('should reject login with missing username', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'password123' })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Username and password are required'
      });
    });

    test('should reject login with missing password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser' })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Username and password are required'
      });
    });

    test('should reject login with non-existent user', async () => {
      mockUserDb.getUserByUsername.mockReturnValue(null);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'password123' })
        .expect(401);

      expect(response.body).toEqual({
        error: 'Invalid username or password'
      });
    });

    test('should reject login with incorrect password', async () => {
      bcrypt.compare.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrongpassword' })
        .expect(401);

      expect(response.body).toEqual({
        error: 'Invalid username or password'
      });
    });

    test('should handle bcrypt compare errors', async () => {
      bcrypt.compare.mockRejectedValue(new Error('Compare error'));

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'password123' })
        .expect(500);

      expect(response.body).toEqual({
        error: 'Internal server error'
      });
    });
  });

  describe('GET /api/auth/user', () => {
    beforeEach(() => {
      // Mock JWT verification
      jwt.verify.mockReturnValue({ userId: 1, username: 'testuser' });
    });

    test('should return user data with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', process.env.JWT_SECRET || 'test-jwt-secret');
      expect(mockUserDb.getUserById).toHaveBeenCalledWith(1);
      expect(response.body).toEqual({
        user: { id: 1, username: 'testuser' }
      });
    });

    test('should reject request without token', async () => {
      const response = await request(app)
        .get('/api/auth/user')
        .expect(401);

      expect(response.body).toEqual({
        error: 'Access denied. No token provided.'
      });
    });

    test('should reject request with invalid token', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403);

      expect(response.body).toEqual({
        error: 'Invalid token'
      });
    });

    test('should reject request with non-existent user', async () => {
      jwt.verify.mockReturnValue({ userId: 999, username: 'nonexistent' });
      mockUserDb.getUserById.mockReturnValue(null);

      const response = await request(app)
        .get('/api/auth/user')
        .set('Authorization', 'Bearer valid-token')
        .expect(401);

      expect(response.body).toEqual({
        error: 'Invalid token. User not found.'
      });
    });
  });

  describe('POST /api/auth/logout', () => {
    beforeEach(() => {
      jwt.verify.mockReturnValue({ userId: 1, username: 'testuser' });
    });

    test('should logout successfully with valid token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Logged out successfully'
      });
    });

    test('should reject logout without token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(401);

      expect(response.body).toEqual({
        error: 'Access denied. No token provided.'
      });
    });
  });
});