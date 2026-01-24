# Testing Patterns

**Analysis Date:** 2026-01-24

## Test Framework

**Status:** Not Configured - No testing framework or test files present in source code.

**Runner:**
- No test runner configured (Jest, Vitest, Mocha, etc. not present)
- No `jest.config.js`, `vitest.config.ts`, or similar configuration files
- No test scripts in `package.json` (only `dev`, `server`, `client`, `build`, `preview`, `start`, `release`)

**Assertion Library:**
- Not applicable - no testing framework integrated

**Run Commands:**
- No test execution commands configured
- Project focuses on manual testing and runtime validation

## Test File Organization

**Location:**
- No test files in codebase (search for `*.test.*`, `*.spec.*` returns no project source files)
- Only found test files in `node_modules` dependencies

**Naming:**
- No naming convention established

**Structure:**
- Not applicable - no test infrastructure

## Test Coverage

**Requirements:** No coverage requirements enforced

**View Coverage:**
- No coverage tools configured (Jest, NYC, Istanbul, etc.)

## Testing Strategy (Runtime Validation)

While no formal test suite exists, the codebase implements comprehensive runtime validation:

### Error Boundaries

**Pattern** from `src/components/ErrorBoundary.jsx`:
- Components catch React render errors
- Display fallback UI on failure
- Prevent entire app crash

### Input Validation

**Backend Route Validation** (Documented Pattern from `server/routes/projects.js`):
```javascript
// Validate required fields first
if (!workspaceType || !workspacePath) {
  return res.status(400).json({ error: 'workspaceType and path are required' });
}

// Type check
if (!['existing', 'new'].includes(workspaceType)) {
  return res.status(400).json({ error: 'workspaceType must be "existing" or "new"' });
}

// Range validation
if (username.length < 3 || password.length < 6) {
  return res.status(400).json({ error: 'Username must be at least 3 characters...' });
}
```

### Path Validation Pattern

**Security-first validation** from `server/routes/projects.js`:
```javascript
async function validateWorkspacePath(requestedPath) {
  try {
    // 1. Resolve to absolute path
    let absolutePath = path.resolve(requestedPath);

    // 2. Check forbidden system directories
    const normalizedPath = path.normalize(absolutePath);
    if (FORBIDDEN_PATHS.includes(normalizedPath) || normalizedPath === '/') {
      return {
        valid: false,
        error: 'Cannot use system-critical directories...'
      };
    }

    // 3. Additional check for path prefixes
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden ||
          normalizedPath.startsWith(forbidden + path.sep)) {
        return {
          valid: false,
          error: `Cannot create workspace in system directory: ${forbidden}`
        };
      }
    }

    // 4. Resolve real path (follow symlinks)
    let realPath = await fs.realpath(absolutePath);

    // 5. Ensure within allowed workspace root
    const resolvedWorkspaceRoot = await fs.realpath(WORKSPACES_ROOT);
    if (!realPath.startsWith(resolvedWorkspaceRoot + path.sep) &&
        realPath !== resolvedWorkspaceRoot) {
      return {
        valid: false,
        error: `Workspace path must be within allowed root: ${WORKSPACES_ROOT}`
      };
    }

    return { valid: true, resolvedPath: realPath };
  } catch (error) {
    return {
      valid: false,
      error: `Path validation failed: ${error.message}`
    };
  }
}
```

### Try/Catch Error Handling

**Pattern** from `server/middleware/auth.js`:
```javascript
const authenticateToken = async (req, res, next) => {
  // Platform mode: use single database user
  if (process.env.VITE_IS_PLATFORM === 'true') {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  // Normal JWT validation
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};
```

### Specific Error Code Handling

**Pattern** from `server/routes/projects.js`:
```javascript
try {
  await fs.access(absolutePath);
} catch (error) {
  if (error.code === 'ENOENT') {
    return res.status(404).json({ error: 'Path does not exist' });
  }
  throw error;  // Re-throw if not handled
}
```

### API Response Validation

**Frontend Pattern** from `src/utils/api.js`:
```javascript
// Helper validates response before consuming
const api = {
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username, password) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    // Consumer validates:
    // if (response.ok) { const data = await response.json(); }
  }
};
```

### Context Validation Pattern

**Pattern** from `src/contexts/WebSocketContext.jsx`:
```javascript
export const useWebSocketContext = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
};
```

### State Initialization Guards

**Pattern** from `src/contexts/AuthContext.jsx`:
```javascript
const checkAuthStatus = async () => {
  try {
    setIsLoading(true);
    setError(null);

    // Check if system needs setup
    const statusResponse = await api.auth.status();
    const statusData = await statusResponse.json();

    if (statusData.needsSetup) {
      setNeedsSetup(true);
      setIsLoading(false);
      return;  // Early exit guard
    }

    // If we have a token, verify it
    if (token) {
      try {
        const userResponse = await api.auth.user();
        if (userResponse.ok) {
          const userData = await userResponse.json();
          setUser(userData.user);
        } else {
          // Token invalid, clear it
          localStorage.removeItem('auth-token');
          setToken(null);
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        localStorage.removeItem('auth-token');
        setToken(null);
      }
    }
  } catch (error) {
    console.error('[AuthContext] Auth status check failed:', error);
    setError(error.message);
  } finally {
    setIsLoading(false);
  }
};
```

## Transaction Handling

**Database Transaction Pattern** from `server/routes/auth.js`:
```javascript
// Use a transaction to prevent race conditions
db.prepare('BEGIN').run();
try {
  // Check if users already exist (only allow one user)
  const hasUsers = userDb.hasUsers();
  if (hasUsers) {
    db.prepare('ROLLBACK').run();
    return res.status(403).json({ error: 'User already exists...' });
  }

  // Hash password
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Create user
  const user = userDb.createUser(username, passwordHash);
  const token = generateToken(user);
  userDb.updateLastLogin(user.id);

  db.prepare('COMMIT').run();

  res.json({
    success: true,
    user: { id: user.id, username: user.username },
    token
  });
} catch (error) {
  db.prepare('ROLLBACK').run();
  throw error;
}
```

## Environment-Specific Validation

**Pattern** from `server/routes/projects.js`:
```javascript
res.status(500).json({
  error: error.message || 'Failed to create workspace',
  details: process.env.NODE_ENV === 'development' ? error.stack : undefined
});
```

**Pattern** from `src/contexts/AuthContext.jsx`:
```javascript
if (import.meta.env.VITE_IS_PLATFORM === 'true') {
  setUser({ username: 'platform-user' });
  setNeedsSetup(false);
  checkOnboardingStatus();
  setIsLoading(false);
  return;
}

checkAuthStatus();
```

## Test Types

**Unit Testing (Manual):**
- Input validation tested via route handlers
- Utility functions validated through runtime behavior
- No automated unit test suite

**Integration Testing (Manual):**
- API endpoints tested with actual HTTP requests
- Database transactions tested in live environment
- Context providers tested with real component usage

**E2E Testing (Manual):**
- Not implemented with automated tools
- Manual testing via UI and CLI

## Validation Gaps and Recommendations

**Areas Without Automated Testing:**
- No test coverage for React component rendering logic
- No tests for WebSocket connection patterns
- No tests for session message parsing and display
- No tests for file upload/download operations
- No tests for Git command execution
- No tests for TaskMaster integration

**Critical Code Tested Only at Runtime:**
- Authentication flows (JWT validation, token generation)
- File system operations (workspace creation, path validation)
- Database operations (user creation, session storage)
- Git operations (clone, pull, push)

**Recommended Testing Strategy:**
- Add Jest or Vitest for React component testing
- Test critical path: auth flow, project creation, session communication
- Mock external dependencies (file system, git, database)
- Add integration tests for API endpoints
- Use Playwright for E2E testing of user flows

---

*Testing analysis: 2026-01-24*
