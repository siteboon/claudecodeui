# Claude CLI Version Detection

This feature provides intelligent Claude CLI version detection and management to handle scenarios where users have multiple Claude CLI installations.

## Problem Solved

When users have multiple Claude CLI installations (e.g., one from npm global install and another from `claude update`), the application might use the wrong version, leading to compatibility issues.

### Example Scenario
- User has Claude v1.0.17 installed at `/usr/local/bin/claude` (from npm)
- User has Claude v1.0.69 installed at `~/.claude/local/claude` (from claude update)
- Without this feature, the app might use the old v1.0.17 due to PATH resolution

## Features

### 1. Automatic Detection
The system automatically scans common installation locations:
- `~/.claude/local/claude` (Claude's self-update location)
- `/usr/local/bin/claude` (npm global install)
- `/usr/bin/claude` (system-wide install)
- All directories in PATH environment variable
- npm/yarn global installation directories

### 2. Version Validation
- Checks the version of each detected installation
- Validates against minimum required version (v1.0.24+)
- Automatically selects the newest valid version

### 3. Enhanced Error Messages
When issues are detected, users see clear messages like:
```
⚠️ Found Claude CLI version 1.0.17 at /usr/local/bin/claude, but version 1.0.24 or higher is required. Please update Claude CLI.

Using: /home/user/.claude/local/claude (v1.0.69)
```

### 4. Configuration Support
Users can specify a custom Claude binary path via `.claudeui.json`:
```json
{
  "claudeBinaryPath": "/path/to/specific/claude"
}
```

## Implementation Details

### Server-Side Components

1. **`server/utils/claude-detector.js`**
   - `detectClaudeInstallations()`: Finds all Claude installations
   - `getBestClaudeBinary()`: Selects the best version or uses configured path
   - `loadClaudeConfig()`: Loads configuration from `.claudeui.json`

2. **`server/claude-cli.js`**
   - Updated to use the detector before spawning Claude
   - Sends warning messages to frontend when issues detected
   - Provides detailed error information

3. **`server/routes/mcp.js`**
   - Updated all MCP-related routes to use the detector

### Frontend Components

**`src/components/ChatInterface.jsx`**
- Handles new `claude-warning` message type
- Displays warnings with yellow indicator
- Shows which Claude installation is being used

### Testing

Run the test script to verify detection:
```bash
node test-claude-detector.js
```

This will:
1. List all detected Claude installations
2. Show which one would be selected
3. Test error handling

## Benefits

1. **Reliability**: Always uses the best available Claude version
2. **Transparency**: Shows users exactly which Claude is being used
3. **Flexibility**: Allows manual override via configuration
4. **User-Friendly**: Clear error messages guide users to fix issues
5. **Future-Proof**: Handles Claude's self-update mechanism properly