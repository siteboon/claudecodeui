# PRETASK API Documentation

This document describes the PRETASK (Pre-Task) functionality that has been added to Claude Code UI.

## Overview

PRETASK functionality allows users to define a queue of tasks that will be automatically executed in sequence when:
1. A task completes successfully 
2. The session has auto-execution enabled
3. There are pending pretasks in the queue

PRETASKs are associated with Claude sessions and execute within the session's context environment.

## Database Schema

### Sessions Table
```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,                    -- Session ID from Claude CLI
    project_name TEXT NOT NULL,             -- Associated project name  
    auto_execute_pretasks BOOLEAN DEFAULT 0, -- Auto-execution toggle
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### PRETASKs Table
```sql
CREATE TABLE pretasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,   -- Unique pretask ID
    session_id TEXT NOT NULL,               -- Foreign key to sessions
    content TEXT NOT NULL,                  -- Task content/command
    order_index INTEGER NOT NULL,          -- Execution order
    is_completed BOOLEAN DEFAULT 0,        -- Completion status
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

## API Endpoints

All endpoints require authentication via `Authorization: Bearer <token>` header.

### 1. Query Session PRETASKs

**GET** `/api/sessions/:sessionId/pretasks`

Get all incomplete pretasks for a session along with auto-execute setting.

**Response:**
```json
{
  "session_id": "session-123",
  "auto_execute": true,
  "pretasks": [
    {
      "id": 1,
      "session_id": "session-123", 
      "content": "List all files in the current directory",
      "order_index": 1,
      "is_completed": 0,
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T12:00:00Z"
    }
  ]
}
```

### 2. Add New PRETASK

**POST** `/api/sessions/:sessionId/pretasks`

Add a new pretask to the session's queue.

**Request Body:**
```json
{
  "content": "Show the current git status",
  "project_name": "my-project" // Optional
}
```

**Response:**
```json
{
  "success": true,
  "pretask": {
    "id": 2,
    "session_id": "session-123",
    "content": "Show the current git status", 
    "order_index": 2,
    "is_completed": 0,
    "created_at": "2024-01-01T12:01:00Z",
    "updated_at": "2024-01-01T12:01:00Z"
  }
}
```

### 3. Delete PRETASK

**DELETE** `/api/sessions/:sessionId/pretasks/:pretaskId`

Delete a specific pretask from the session's queue.

**Response:**
```json
{
  "success": true
}
```

### 4. Update PRETASK Order

**PUT** `/api/sessions/:sessionId/pretasks/order`

Reorder pretasks by updating their order_index values.

**Request Body:**
```json
{
  "pretasks": [
    { "id": 2, "order_index": 1 },
    { "id": 1, "order_index": 2 },
    { "id": 3, "order_index": 3 }
  ]
}
```

**Response:**
```json
{
  "success": true
}
```

### 5. Toggle Auto-Execute

**PUT** `/api/sessions/:sessionId/auto-execute`

Enable or disable automatic execution of pretasks for a session.

**Request Body:**
```json
{
  "auto_execute": true
}
```

**Response:**
```json
{
  "success": true,
  "auto_execute": true
}
```

### 6. Get Next PRETASK (Internal)

**GET** `/api/sessions/:sessionId/pretasks/next`

Get the next pretask for execution (used internally by the auto-execution system).

**Response:**
```json
{
  "has_next": true,
  "auto_execute": true,
  "pretask": {
    "id": 1,
    "session_id": "session-123",
    "content": "List all files in the current directory",
    "order_index": 1,
    "is_completed": 0,
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

### 7. Mark PRETASK Complete (Internal)

**PUT** `/api/sessions/:sessionId/pretasks/:pretaskId/complete`

Mark a pretask as completed (used internally by the auto-execution system).

**Response:**
```json
{
  "success": true
}
```

## WebSocket Events

The PRETASK system integrates with the existing WebSocket chat interface and emits the following events:

### pretask-start
Emitted when a pretask begins auto-execution.
```json
{
  "type": "pretask-start",
  "sessionId": "session-123",
  "pretask": {
    "id": 1,
    "content": "List all files in the current directory",
    "order_index": 1
  }
}
```

### pretask-complete  
Emitted when a pretask completes successfully.
```json
{
  "type": "pretask-complete", 
  "sessionId": "session-123",
  "pretask": {
    "id": 1,
    "content": "List all files in the current directory", 
    "order_index": 1
  }
}
```

### pretask-error
Emitted when a pretask fails during execution.
```json
{
  "type": "pretask-error",
  "sessionId": "session-123", 
  "pretask": {
    "id": 1,
    "content": "List all files in the current directory",
    "order_index": 1
  },
  "error": "Command failed with exit code 1"
}
```

### pretask-queue-empty
Emitted when all pretasks in the queue have been completed.
```json
{
  "type": "pretask-queue-empty",
  "sessionId": "session-123"
}
```

## Auto-Execution Flow

1. User completes a task in a Claude session
2. System detects `claude-complete` WebSocket message with `exitCode: 0`
3. If session has `auto_execute_pretasks = 1`, system checks for next pretask
4. If pretask exists, system executes it using Claude CLI with session resume
5. Upon completion, pretask is marked as completed and flow repeats
6. User can interrupt auto-execution by sending manual commands

## Error Handling

- **404**: Session or pretask not found
- **400**: Invalid request data (missing content, invalid order, etc.)
- **403**: Pretask doesn't belong to session
- **500**: Database or system errors

## Example Usage Workflow

```bash
# 1. Start a session and get session ID from Claude CLI
curl -X GET "http://localhost:3001/api/sessions/session-123/pretasks" \
     -H "Authorization: Bearer <token>"

# 2. Add pretasks to the session  
curl -X POST "http://localhost:3001/api/sessions/session-123/pretasks" \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"content": "git status"}'

curl -X POST "http://localhost:3001/api/sessions/session-123/pretasks" \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"content": "npm test"}'

# 3. Enable auto-execution
curl -X PUT "http://localhost:3001/api/sessions/session-123/auto-execute" \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"auto_execute": true}'

# 4. Now when tasks complete in the session, pretasks will execute automatically
```

## Implementation Notes

- Sessions are created on-demand when first accessed
- PRETASK execution uses Claude CLI with `--resume` flag to maintain session context
- Auto-execution stops if any pretask fails
- Manual user commands interrupt auto-execution temporarily
- Database uses SQLite with proper foreign key constraints
- All operations are transactional for data consistency