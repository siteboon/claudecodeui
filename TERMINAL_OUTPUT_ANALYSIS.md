# Claude Code CLI Terminal Output Analysis

## Overview
This document analyzes what meaningful information the Claude Code CLI shows in terminal that the current UI might be missing when using `--output-format stream-json`.

## Terminal-Specific Features Currently Missing from UI

### 1. Interactive Permission Prompts
**Terminal Behavior:**
- Shows interactive prompts asking users to approve/deny tool usage
- Displays context about what permission is being requested
- Allows "Always allow" selections during a session
- Shows permission request details (file paths, commands to be executed)

**Current UI Implementation:**
- Permissions are pre-configured via settings
- No interactive approval flow during execution
- Uses `--dangerously-skip-permissions` or pre-configured `--allowedTools`/`--disallowedTools`

### 2. Real-Time Progress Indicators
**Terminal Behavior:**
- Animated spinners (✻ ✹ ✸ ✶) during processing
- "Task(...)" indicators when spinning up subagents
- Terminal bell notifications for long-running tasks
- Progress bars or percentage indicators for multi-step operations

**Current UI Implementation:**
- Basic spinner animation in ClaudeStatus component
- No detailed progress for individual tool executions
- No sub-agent task indicators

### 3. Tool Execution Context
**Terminal Behavior:**
- Shows which tool is currently being executed
- Displays tool parameters before execution
- Shows approval status for each tool call
- Indicates when tools are queued vs executing

**Current UI Implementation:**
- Tool information is shown after execution in accordion format
- No real-time "about to execute" notifications
- No queue status indicators

### 4. System/Debug Information
**Terminal Behavior:**
- MCP server connection status
- Tool availability checks
- Permission mode indicators
- Context window usage ("context left" indicator)
- Session initialization details

**Current UI Implementation:**
- Limited to session ID and model info
- No MCP server status visibility
- No context window metrics

### 5. Interactive Session Controls
**Terminal Behavior:**
- Escape to interrupt Claude mid-execution
- Double-escape to jump back in history
- Slash commands (/clear, /permissions, /init)
- Shift+Tab for auto-accept mode toggle

**Current UI Implementation:**
- Abort button for entire session only
- No mid-execution interruption
- No history navigation
- No slash command support

### 6. Error Context and Formatting
**Terminal Behavior:**
- Colored error output
- Stack traces with proper formatting
- Clear distinction between Claude errors vs tool errors
- Line numbers and file context for errors

**Current UI Implementation:**
- Basic error messages in chat
- Limited formatting for error details
- No color coding for error severity

### 7. Multi-Step Operation Feedback
**Terminal Behavior:**
- Step-by-step progress for complex operations
- "Thinking" mode indicators (think/think hard/ultrathink)
- Clear delineation between planning and execution phases
- Intermediate results display

**Current UI Implementation:**
- Single loading state for entire operation
- No visibility into intermediate steps
- No thinking mode indicators

### 8. Performance Metrics
**Terminal Behavior:**
- API response times
- Token usage per request
- Cost calculations
- Cache hit information

**Current UI Implementation:**
- Shows total tokens in some cases
- No detailed performance metrics
- No cost visibility

## Stream-JSON Format Limitations

The `--output-format stream-json` mode provides structured data but loses:
1. Human-readable progress messages
2. Interactive prompt capabilities
3. Colored/formatted output
4. ASCII progress indicators
5. Terminal bell notifications
6. Direct user intervention points

## Recommendations for UI Enhancement

### High Priority
1. **Add Permission Request UI**: Implement interactive permission dialogs that appear when Claude needs approval
2. **Tool Execution Preview**: Show what tool is about to run with parameters before execution
3. **Real-time Progress**: Add detailed progress indicators for multi-step operations
4. **Interrupt Capability**: Allow users to interrupt specific tool executions, not just abort entire session

### Medium Priority
1. **Context Window Indicator**: Show remaining context like the CLI does
2. **MCP Server Status**: Display connection status for MCP servers
3. **Performance Metrics**: Add token usage and timing information
4. **Enhanced Error Display**: Improve error formatting with context

### Low Priority
1. **Slash Commands**: Implement UI equivalents for CLI slash commands
2. **History Navigation**: Add ability to jump back in conversation history
3. **Thinking Mode Indicators**: Show when Claude is in different thinking modes
4. **Cost Tracking**: Display estimated costs for operations

## Implementation Notes

- The current implementation uses `--output-format stream-json` which provides structured data but loses interactive capabilities
- To capture more terminal-specific output, the UI could:
  - Parse additional verbose output from stderr
  - Implement a custom output parser for non-JSON terminal messages
  - Use a PTY-based approach to capture full terminal output
  - Enhance the WebSocket protocol to send additional status messages