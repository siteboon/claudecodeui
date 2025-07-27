-- Migration to add GitHub OAuth support
-- This migration adds fields needed for GitHub authentication

-- Add GitHub-related columns to users table
ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local';
ALTER TABLE users ADD COLUMN github_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN github_username TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- Make password_hash nullable for OAuth users
-- SQLite doesn't support directly modifying column constraints, so we need to recreate the table
CREATE TABLE users_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT, -- Now nullable for OAuth users
    auth_provider TEXT DEFAULT 'local',
    github_id TEXT UNIQUE,
    github_username TEXT,
    email TEXT,
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1
);

-- Copy existing data
INSERT INTO users_new (id, username, password_hash, created_at, last_login, is_active)
SELECT id, username, password_hash, created_at, last_login, is_active FROM users;

-- Drop old table and rename new one
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Recreate indexes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_users_github_id ON users(github_id);
CREATE INDEX idx_users_auth_provider ON users(auth_provider);

-- Add sessions table for OAuth state management
CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
);

CREATE INDEX idx_sessions_expire ON sessions(expire);