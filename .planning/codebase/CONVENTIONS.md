# Coding Conventions

**Analysis Date:** 2026-01-24

## Naming Patterns

**Files:**
- React components: PascalCase with `.jsx` extension (e.g., `ChatInterface.jsx`, `TaskIndicator.jsx`, `WebSocketContext.jsx`)
- Utility/helper files: camelCase with `.js` extension (e.g., `api.js`, `websocket.js`, `utils.js`)
- Routes: camelCase with `.js` extension (e.g., `auth.js`, `projects.js`, `taskmaster.js`)
- Contexts: PascalCase ending with `Context` (e.g., `WebSocketContext.jsx`, `AuthContext.jsx`, `TaskMasterContext.jsx`)

**Functions:**
- Use camelCase for all function names
- Async functions explicitly marked with `async` keyword
- Higher-order functions and hooks start with prefix (e.g., `useWebSocket`, `useAuth`)
- Helper functions for components use camelCase (e.g., `decodeHtmlEntities`, `normalizeInlineCodeFences`)

**Variables:**
- Use `const` by default; use `let` only when value must change after initialization
- Avoid `var` (not observed in codebase)
- State variables use camelCase: `const [isLoading, setIsLoading] = useState(false)`
- Boolean variables prefix with `is`, `has`, or `should`: `isConnected`, `hasUsers`, `shouldShowTasksTab`
- Object grouping uses descriptive names: `{ width, height, size }` for sizing

**Types:**
- No TypeScript; pure JavaScript (JSX)
- JSDoc comments for function documentation and parameter types (when used)
- No type annotations outside of JSDoc

## Code Style

**Formatting:**
- No Prettier or ESLint configuration files found; formatting appears manual
- 2-space indentation observed consistently
- Line length: varies but generally under 100 characters
- Trailing commas in multi-line arrays/objects

**Linting:**
- No linting configuration detected in project root
- No `.eslintrc` or similar files present
- No pre-commit hooks enforcing style

**Spacing:**
- Single space after keywords (`if (`, `for (`, `switch (`)
- No space between function name and parentheses for declarations: `function getName() {}`
- No space between method calls: `array.map()`

## Import Organization

**Order:**
1. External dependencies from `node_modules` (React, third-party libraries)
2. Relative imports from parent or sibling directories
3. Context/utility imports from project utilities

**Path Aliases:**
- No path aliases configured; all imports use relative paths
- Frontend: Relative paths from component location (e.g., `../contexts/`, `../lib/`)
- Backend: Relative paths from route/module location (e.g., `../database/db.js`, `../middleware/auth.js`)

**Pattern Example** (`src/contexts/AuthContext.jsx`):
```javascript
import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../utils/api';
```

**Pattern Example** (`src/components/TaskIndicator.jsx`):
```javascript
import React from 'react';
import { CheckCircle, Settings, X, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
```

**Pattern Example** (Backend `server/routes/auth.js`):
```javascript
import express from 'express';
import bcrypt from 'bcrypt';
import { userDb, db } from '../database/db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
```

## Error Handling

**Pattern - Try/Catch with Logging:**
```javascript
try {
  // operation
  const result = await someAsyncOperation();
  return result;
} catch (error) {
  console.error('Descriptive error context:', error);
  res.status(500).json({ error: 'Internal server error' });
}
```

**Pattern - Input Validation:**
- Validate before operations
- Return early with appropriate status codes
- Always return error response with `error` field

```javascript
if (!username || !password) {
  return res.status(400).json({ error: 'Username and password are required' });
}
```

**Pattern - Specific Error Codes:**
- Check specific error codes (e.g., `error.code === 'ENOENT'`) before generic catch
- Distinguish between user errors (4xx) and server errors (5xx)
- Example from `server/routes/projects.js`:
```javascript
try {
  await fs.access(absolutePath);
  const stats = await fs.stat(absolutePath);
} catch (error) {
  if (error.code === 'ENOENT') {
    return res.status(404).json({ error: 'Workspace path does not exist' });
  }
  throw error;
}
```

**Pattern - Database Transactions:**
- Begin transaction before multi-step operations
- ROLLBACK on error, COMMIT on success
- From `server/routes/auth.js`:
```javascript
db.prepare('BEGIN').run();
try {
  const hasUsers = userDb.hasUsers();
  if (hasUsers) {
    db.prepare('ROLLBACK').run();
    return res.status(403).json({ error: 'User already exists.' });
  }
  // Operations...
  db.prepare('COMMIT').run();
} catch (error) {
  db.prepare('ROLLBACK').run();
  throw error;
}
```

## Logging

**Framework:** Native `console` object

**Patterns:**
- Use `console.error()` for errors, exceptions, and failures
- Use `console.warn()` for warnings or unexpected states
- Use `console.log()` sparingly for important startup/status info
- Include context in error messages: `console.error('Component name or context:', error)`

**Examples from codebase:**
- `console.error('Error checking onboarding status:', error)` - `AuthContext.jsx:53`
- `console.warn('No authentication token found for WebSocket connection')` - `websocket.js:37`
- `console.error('Projects API returned non-array data:', projectsData)` - `TaskMasterContext.jsx:101`

**Server-side Convention:**
- Log all errors with descriptive prefix
- Include operation context in messages
- Example: `console.error('Registration error:', error)`

## Comments

**When to Comment:**
- Explain complex algorithms or non-obvious logic
- Document architectural decisions and data flow
- Clarify edge cases and gotchas
- Mark sections with region comments for large files

**JSDoc/TSDoc:**
- Used sparingly for major component/function definitions
- Multi-line comments with `/** ... */` format
- Document purpose, not obvious functionality

**Example** from `src/components/TaskIndicator.jsx`:
```javascript
/**
 * TaskIndicator Component
 *
 * Displays TaskMaster status for projects in the sidebar with appropriate
 * icons and colors based on the project's TaskMaster configuration state.
 */
const TaskIndicator = ({
  status = 'not-configured',
  ...
}) => {
```

**Architecture Documentation:**
- Large files begin with multi-line comment explaining system
- Example from `server/projects.js`:
```javascript
/**
 * PROJECT DISCOVERY AND MANAGEMENT SYSTEM
 * ========================================
 *
 * This module manages project discovery for both Claude CLI and Cursor CLI sessions.
 *
 * ## Architecture Overview
 * ...
 */
```

**Inline Comments:**
- Mark passthrough layers and architectural decisions
- Example from `src/components/MainContent.jsx`:
```javascript
/*
 * MainContent.jsx - Main Content Area with Session Protection Props Passthrough
 *
 * SESSION PROTECTION PASSTHROUGH:
 * ===============================
 *
 * This component serves as a passthrough layer for Session Protection functions:
 * - Receives session management functions from App.jsx
 * - Passes them down to ChatInterface.jsx
 *
 * No session protection logic is implemented here - it's purely a props bridge.
 */
```

## Function Design

**Size:**
- Most utility functions 10-50 lines
- Complex functions like route handlers 20-80 lines
- Component render functions can exceed 100 lines for complex UI (e.g., `ChatInterface.jsx` is 5522 lines)

**Parameters:**
- Use destructuring for object parameters
- Provide defaults for optional parameters using default assignment
- Example from `TaskIndicator.jsx`:
```javascript
const TaskIndicator = ({
  status = 'not-configured',
  size = 'sm',
  className = '',
  showLabel = false
}) => {
```

**Return Values:**
- Functions return meaningful data or objects with status/error fields
- API endpoints return JSON with `{ success: boolean, error?: string, data?: any }`
- Async functions always wrapped to handle rejections

**Example** from `server/routes/projects.js`:
```javascript
return {
  valid: true,
  resolvedPath: realPath
};

// On error:
return {
  valid: false,
  error: `Path validation failed: ${error.message}`
};
```

## Module Design

**Exports:**
- Named exports used consistently
- Single default export per file (sometimes both named + default)
- Example from `src/contexts/WebSocketContext.jsx`:
```javascript
export const useWebSocketContext = () => { ... };
export const WebSocketProvider = ({ children }) => { ... };
export default WebSocketContext;
```

**Barrel Files:**
- No index.js barrel exports observed in codebase
- Direct imports from specific files

**File Structure Patterns:**
- Backend routes export Express router: `export default router`
- Context providers export hook + Provider component + Context
- Utility files export named functions: `export const authenticatedFetch = (...) => {}`
- Components export as default: `export default TaskIndicator`

## React-Specific Patterns

**Hooks:**
- Custom hooks named with `use` prefix (e.g., `useWebSocket`, `useAuth`)
- Hooks used in function components following React conventions
- Context hooks validate context exists before returning: `if (!context) throw new Error(...)`

**Context Pattern:**
- Create context with default value object
- Export custom hook for context access with validation
- Export Provider component that uses hook
- Example from `src/contexts/WebSocketContext.jsx`:
```javascript
const WebSocketContext = createContext({...});
export const useWebSocketContext = () => {...};
export const WebSocketProvider = ({ children }) => {...};
```

**Component Props:**
- Destructured at function signature
- Pass-through props documented when used for delegation
- Large prop lists organized with comments for readability

**Styling:**
- Tailwind CSS classes with `cn()` utility function from `lib/utils.js`
- `cn()` merges `clsx` and `tailwind-merge` for safe class composition
- Example from `src/components/ui/button.jsx`:
```javascript
const buttonVariants = cva("inline-flex items-center ...", {
  variants: {
    variant: { ... },
    size: { ... }
  }
});

const Button = React.forwardRef(({ className, variant, size, ...props }, ref) => (
  <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
));
```

**Class Variance Authority (CVA):**
- Used for component variant definitions in UI components
- Exported alongside component for reuse

---

*Convention analysis: 2026-01-24*
