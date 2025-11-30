# Feature: Permissions and Approval System

## Feature Description
The Permissions and Approval System is a comprehensive authorization and control mechanism that governs how the Claude CLI agent executes actions. It provides multiple permission modes, interactive approval workflows, and dynamic permission updates based on user decisions. The system includes a special plan mode that allows users to review and approve execution plans before the agent proceeds with implementation, along with the ability to switch permission modes after plan approval.

## User Story
As a user of the Claude CLI
I want to control what actions the agent can perform automatically or require my approval
So that I can maintain security, review critical operations, and have confidence in what the agent does on my system

## Problem Statement
When using an AI agent that can execute commands, read/write files, and interact with the system, users need granular control over what actions can happen automatically versus what requires explicit approval. Different use cases require different levels of control:
- Some users want maximum control and approve every action
- Some users want to approve only certain high-risk operations
- Some users want to review strategic plans before execution
- Users need to understand what the agent is doing and why

## Solution Statement
The system implements a multi-layered permission architecture with:
1. **Permission Mode Manager** - Manages different operational modes (default, acceptEdits, bypassPermissions, plan)
2. **Permission Handler** - Intercepts tool usage and prompts for approval based on mode and tool type
3. **Plan Mode** - Presents execution plans for review and approval with permission mode selection
4. **Stream Renderer** - Displays plan approval UI and manages mode transitions
5. **REPL Integration** - Executes approved plans asynchronously after user approval

## Relevant Files
Use these files to implement the feature:

### Core Permission System
- **src/permissions/modes.ts** - Defines `PermissionModeManager` class that manages permission modes and determines when permissions are required. Contains logic for four modes: default, acceptEdits, bypassPermissions, and plan.

- **src/permissions/permission-handler.ts** - Implements `PermissionHandler` class that intercepts tool usage via the `canUseTool` callback. Handles permission prompts, "always allow" decisions, and special handling for AskUserQuestion and ExitPlanMode tools.

### Plan Mode Implementation
- **src/plan/plan-mode.ts** - Implements `PlanMode` class with `presentPlan()` method that displays plans and collects user approval decisions. Provides three options: approve with auto-accept edits, approve with manual approval, or reject and keep planning.

### UI Components
- **src/ui/stream-renderer.ts** - `StreamRenderer` class that renders SDK messages and handles plan presentation. When ExitPlanMode tool is detected, it presents the plan, processes approval, and switches permission modes accordingly.

- **src/ui/question-prompt.ts** - `QuestionPrompt` class that handles AskUserQuestion tool interactions with support for single-select, multi-select, and custom input options.

### Integration Layer
- **src/cli/repl.ts** - Main REPL loop that integrates all permission components. Manages raw mode for ESC key interruption, handles plan execution flow, and maintains `pendingPlanExecution` flag for asynchronous plan execution.

- **src/agent/query-handler.ts** (referenced but not read) - Handles query execution and provides the message stream that feeds into the renderer.

### Type Definitions
- **src/types/index.ts** - Defines core types:
  - `PermissionMode`: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
  - `PlanPresentation`: Contains plan string, approval status, and optional permission mode
  - `UserQuestion`: Structure for questions with options and multi-select support
  - `PermissionRequest` and `PermissionResponse`: Request/response types for permissions

## Implementation Plan

### Phase 1: Foundation - Permission Mode Management
The foundation establishes the permission mode system that determines when and how permissions are required. The `PermissionModeManager` provides mode switching, mode checking, and tool classification logic.

**Key Components:**
- Mode enumeration (default, acceptEdits, bypassPermissions, plan)
- Mode state management with getters and setters
- Tool classification (edit tools vs other tools)
- Permission requirement determination based on mode and tool type

### Phase 2: Core Implementation - Permission Handler and Callbacks
The core implementation provides the `canUseTool` callback that intercepts every tool invocation. It implements the approval flow, "always allow" tracking, and integration with the permission mode system.

**Key Components:**
- `getCanUseToolCallback()` returns the async callback function
- Permission bypass logic for auto-approved scenarios
- Interactive permission prompts using inquirer
- "Always Allow" functionality with in-memory tracking
- Special handling for AskUserQuestion and ExitPlanMode tools
- Raw mode management for proper terminal input handling

### Phase 3: Integration - Plan Mode and REPL Flow
The integration phase connects plan mode presentation with permission management and enables asynchronous plan execution. When a plan is approved, the system switches permission modes and automatically triggers plan execution.

**Key Components:**
- Plan presentation UI with three approval options
- Mode switching after plan approval
- `planApproved` flag tracking in StreamRenderer
- `pendingPlanExecution` flag in REPL
- Asynchronous plan execution using `setImmediate()`
- Prompt updates when mode changes

## Step by Step Tasks

### Step 1: Create Permission Mode Types and Manager
- Define `PermissionMode` type with four valid values
- Create `PermissionModeManager` class with mode state management
- Implement `shouldBypassPermissions()` for bypass mode check
- Implement `shouldAutoAcceptEdits()` for acceptEdits mode check
- Implement `isInPlanMode()` for plan mode check
- Implement `isEditTool()` to classify edit-related tools
- Implement `requiresPermission()` combining mode and tool checks
- Add unit tests for mode manager covering all four modes and tool classifications

### Step 2: Implement Permission Handler Core Logic
- Create `PermissionHandler` class with mode manager dependency
- Initialize `alwaysAllowedTools` Set for tracking approved tools
- Implement `getCanUseToolCallback()` returning the `CanUseTool` async function
- Add bypass logic for `bypassPermissions` mode (immediate allow)
- Add auto-accept logic for `acceptEdits` mode + edit tools
- Add auto-allow logic for `ExitPlanMode` tool when in plan mode
- Add "always allowed" check before prompting
- Route to `promptForPermission()` for manual approval
- Add unit tests for callback logic with mocked dependencies

### Step 3: Implement Permission Prompt UI
- Implement `promptForPermission()` method in PermissionHandler
- Display permission request box with tool name and input
- Use inquirer to prompt with three choices: Allow, Always Allow, Deny
- Handle "Always Allow" by adding tool to `alwaysAllowedTools` Set
- Return appropriate response objects based on user decision
- Handle AbortSignal for interruption support
- Integrate raw mode disable/enable for proper terminal behavior
- Add integration tests for prompt flow with mock inquirer

### Step 4: Implement AskUserQuestion Handler
- Implement `handleUserQuestion()` method in PermissionHandler
- Extract questions array from tool input
- Integrate with `QuestionPrompt` class for each question
- Handle single-select vs multi-select questions
- Collect answers into a Record<string, string>
- Return updated tool input with answers embedded
- Handle interruption and errors gracefully
- Add unit tests for question handling with various input types

### Step 5: Create Question Prompt UI Component
- Create `QuestionPrompt` class with `askQuestion()` method
- Display question header and question text with formatting
- Build choices array from question options
- Add "Other" option with custom input support
- Use inquirer checkbox for multi-select questions
- Use inquirer list for single-select questions
- Handle custom input collection when "Other" selected
- Return array of selected values
- Add unit tests for QuestionPrompt with various question types

### Step 6: Implement Plan Mode Presentation
- Create `PlanMode` class with `presentPlan()` method
- Display plan in formatted box with separators
- Use inquirer list prompt with three options:
  - "Yes, and auto-accept edits" (maps to 'acceptEdits' mode)
  - "Yes, and manually approve edits" (maps to 'default' mode)
  - "No, keep planning" (rejects plan)
- Display hint about ctrl-g to edit plan in code
- Return `PlanPresentation` object with plan, approved flag, and permission mode
- Add unit tests for plan presentation with mocked inquirer

### Step 7: Integrate Plan Mode into Stream Renderer
- Add `planMode` instance and `planApproved` flag to StreamRenderer
- Accept `modeManager` and `onModeChange` callback in constructor
- Detect `ExitPlanMode` tool use in assistant messages
- Call `planMode.presentPlan()` when ExitPlanMode detected
- Update `modeManager` with selected permission mode if plan approved
- Display approval confirmation message with mode name
- Display rejection message if plan not approved
- Store approval state in `planApproved` flag
- Provide `isPlanApproved()` getter method
- Add `reset()` method to clear approval state between queries
- Add unit tests for plan rendering flow

### Step 8: Integrate Plan Execution into REPL
- Add `pendingPlanExecution` flag to REPL class
- Add raw mode enable/disable methods with ESC key detection
- Configure ESC key listener to call `queryHandler.interrupt()`
- After query completion, check if plan was approved using `streamRenderer.isPlanApproved()`
- Set `pendingPlanExecution` flag if plan approved
- In finally block, check `pendingPlanExecution` flag
- Use `setImmediate()` to asynchronously trigger plan execution
- Send "Please proceed with executing the approved plan step by step" prompt
- Clear `pendingPlanExecution` flag before execution
- Update prompt after mode changes using `onModeChange` callback
- Add integration tests for plan execution flow

### Step 9: Implement Raw Mode Management
- Add `rawModeEnabled` flag and `dataListener` to REPL
- Implement `enableRawMode()` checking TTY and flag state
- Set process.stdin to raw mode when enabling
- Register data listener for ESC key detection (charCode 27)
- Call interrupt on ESC key press during processing
- Implement `disableRawMode()` to cleanup listener and restore mode
- Call disable/enable around inquirer prompts in PermissionHandler
- Add error handling for raw mode operations
- Add unit tests for raw mode state management

### Step 10: Add Permission Mode Switching Command
- Implement `/mode` command handler in REPL
- Display current mode when no argument provided
- Validate mode argument against valid modes list
- Call `modeManager.setMode()` with validated mode
- Display confirmation message with new mode
- Update readline prompt to reflect new mode
- Add mode color coding in prompt (magenta for plan, red for bypass, yellow for acceptEdits, green for default)
- Add integration tests for mode switching command

### Step 11: Integrate Permission System with Query Handler
- Pass `permissionHandler.getCanUseToolCallback()` to SDK Options
- Include `permissionMode` in Options for SDK awareness
- Configure raw mode enable before query execution
- Configure raw mode disable after query completion
- Handle AbortError from interruption gracefully
- Ensure permission callback receives correct context
- Add integration tests for query execution with various permission modes

### Step 12: Add Permission Mode to Session Metadata
- Include `permissionMode` in SessionMetadata type
- Store current permission mode when creating session
- Restore permission mode when loading session
- Update session metadata when mode changes
- Add tests for session persistence with permission modes

### Step 13: Run Full Integration Tests
- Test default mode requiring approval for all tools
- Test acceptEdits mode auto-approving edit tools but prompting for others
- Test bypassPermissions mode allowing all tools without prompts
- Test plan mode with plan presentation and approval flow
- Test "Always Allow" functionality persisting across tool uses
- Test mode switching during session
- Test plan approval with acceptEdits mode transition
- Test plan approval with default mode transition
- Test plan rejection keeping plan mode active
- Test asynchronous plan execution after approval
- Test ESC key interruption during query processing
- Test AskUserQuestion flow with various question types

### Step 14: Validation and Final Testing
Execute the Validation Commands to ensure zero regressions and correct functionality across all permission modes and approval scenarios.

## Testing Strategy

### Unit Tests
- **PermissionModeManager**
  - Test mode getters and setters
  - Test `shouldBypassPermissions()` for each mode
  - Test `shouldAutoAcceptEdits()` for each mode
  - Test `isInPlanMode()` for each mode
  - Test `isEditTool()` with various tool names
  - Test `requiresPermission()` combining mode and tool type

- **PermissionHandler**
  - Test bypass permission mode flow
  - Test auto-accept edits mode flow
  - Test ExitPlanMode auto-allow in plan mode
  - Test "Always Allow" functionality
  - Test permission prompt with Allow decision
  - Test permission prompt with Always Allow decision
  - Test permission prompt with Deny decision
  - Test AskUserQuestion handler with various question types
  - Test AbortSignal handling

- **PlanMode**
  - Test plan presentation UI rendering
  - Test approve with acceptEdits decision
  - Test approve with default mode decision
  - Test reject decision
  - Test PlanPresentation return structure

- **StreamRenderer**
  - Test ExitPlanMode detection and handling
  - Test plan approval with mode switching
  - Test plan rejection preserving plan mode
  - Test `isPlanApproved()` getter
  - Test `reset()` clearing approval state
  - Test mode change callback invocation

- **QuestionPrompt**
  - Test single-select questions
  - Test multi-select questions
  - Test "Other" option with custom input
  - Test answer formatting and return structure

### Integration Tests
- **Permission Flow Tests**
  - Test full permission request and approval flow in default mode
  - Test auto-accept edit tools in acceptEdits mode
  - Test bypass all permissions in bypassPermissions mode
  - Test "Always Allow" persisting across multiple tool uses
  - Test mode switching during active session

- **Plan Mode Tests**
  - Test plan presentation and approval with mode transition to acceptEdits
  - Test plan presentation and approval with mode transition to default
  - Test plan rejection maintaining plan mode
  - Test asynchronous plan execution after approval
  - Test plan execution prompt generation

- **REPL Integration Tests**
  - Test raw mode enable/disable lifecycle
  - Test ESC key interruption during processing
  - Test prompt updates after mode changes
  - Test `/mode` command with valid and invalid modes
  - Test session creation with permission mode
  - Test session restoration with permission mode

- **Question Flow Tests**
  - Test AskUserQuestion end-to-end flow
  - Test question rendering and answer collection
  - Test multi-select answer formatting
  - Test custom input handling

### Edge Cases
- User interrupts permission prompt with Ctrl+C or ESC
- Permission prompt receives AbortSignal during display
- Tool is in "Always Allow" set but mode changes
- Plan mode activated but ExitPlanMode never called
- Plan approved but execution fails to start
- Raw mode already enabled when trying to enable again
- Raw mode fails to enable on non-TTY terminals
- Mode switching while query is in progress
- Session loaded with unknown permission mode value
- AskUserQuestion with empty questions array
- AskUserQuestion with malformed question objects
- Multiple rapid mode switches
- Permission callback called with missing toolName or toolInput
- Plan presentation with empty or malformed plan string

## Acceptance Criteria
1. **Permission Mode Management**
   - All four permission modes (default, acceptEdits, bypassPermissions, plan) function correctly
   - Mode can be switched during active session via `/mode` command
   - Mode is persisted in session metadata and restored on session load
   - Prompt displays current mode with appropriate color coding

2. **Permission Prompts**
   - In default mode, user is prompted before every tool execution
   - In acceptEdits mode, edit tools execute automatically but other tools prompt
   - In bypassPermissions mode, no prompts are shown for any tool
   - Permission prompts display tool name and input parameters clearly
   - User can choose Allow, Always Allow, or Deny

3. **Always Allow Functionality**
   - Tools added to "Always Allow" list execute without prompts in subsequent uses
   - "Always Allow" list persists throughout the session
   - "Always Allow" status is shown in permission handler logs

4. **Plan Mode**
   - ExitPlanMode tool triggers plan presentation UI automatically
   - Plan is displayed in formatted box with clear separators
   - User can choose to approve with acceptEdits, approve with default mode, or reject
   - Approved plans switch permission mode as selected
   - Rejected plans keep the session in plan mode
   - Plan approval triggers automatic execution with appropriate follow-up prompt

5. **Plan Execution**
   - Approved plans execute asynchronously after current query completes
   - Execution starts automatically without additional user input
   - Execution prompt is "Please proceed with executing the approved plan step by step"
   - Permission mode is set correctly before execution begins

6. **AskUserQuestion**
   - Questions are presented in formatted boxes with headers
   - Single-select questions use list prompts
   - Multi-select questions use checkbox prompts
   - "Other" option allows custom input
   - Answers are collected and returned in tool input

7. **Interruption Handling**
   - Ctrl+C interrupts current operation and returns to prompt
   - ESC key interrupts current operation when raw mode is enabled
   - Interrupted operations display appropriate warning message
   - AbortSignal is respected in permission prompts and question prompts

8. **Raw Mode Management**
   - Raw mode is enabled during query processing for ESC detection
   - Raw mode is disabled during inquirer prompts for proper input
   - Raw mode state is cleaned up on REPL close
   - Raw mode operations handle TTY checks and errors gracefully

9. **UI and UX**
   - All prompts use consistent formatting with boxes and separators
   - Color coding is used appropriately (cyan for questions, yellow for permissions, magenta for plans)
   - Tool emoji indicators make operations visually identifiable
   - Prompt updates immediately when mode changes

10. **Error Handling**
    - All async operations handle errors gracefully
    - Permission denials are logged and communicated clearly
    - Failed plan executions display error messages
    - AbortSignal interruptions are handled without crashes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

```bash
npm run typecheck
```
Ensures all TypeScript types are correct and the permission system types integrate properly with SDK types.

```bash
npm test
```
Runs all unit tests for permission modes, permission handler, plan mode, stream renderer, and question prompts.

```bash
npm run test:integration
```
Runs integration tests covering permission flows, plan mode workflows, and REPL integration.

```bash
npm run build
```
Compiles the TypeScript code to ensure no build errors exist.

```bash
npm start
```
Starts the CLI for manual testing. Test the following scenarios:
1. Start in default mode and test permission prompts
2. Switch to acceptEdits mode with `/mode acceptEdits`
3. Test edit tool auto-acceptance
4. Switch to plan mode with `/mode plan`
5. Trigger plan presentation and approve with auto-accept
6. Verify plan execution starts automatically
7. Test ESC key interruption during processing
8. Test "Always Allow" functionality

```bash
npm start -- --permission-mode plan
```
Starts in plan mode to test plan workflow from the beginning.

```bash
npm start -- --permission-mode bypassPermissions
```
Starts in bypass mode to verify no prompts appear and all tools execute automatically.

## Notes

### Architecture Highlights
- **Separation of Concerns**: Permission logic, UI presentation, and execution flow are cleanly separated into different modules
- **Callback Pattern**: The `canUseTool` callback provides a clean integration point with the SDK
- **Async/Await**: All permission and approval operations use async/await for proper flow control
- **State Management**: Permission mode state is managed centrally and can be updated dynamically
- **Terminal Control**: Raw mode management enables advanced keyboard input like ESC key detection

### Design Decisions
- **"Always Allow" is Session-Scoped**: The "Always Allow" list is stored in memory and resets between sessions for security
- **Plan Execution is Asynchronous**: Using `setImmediate()` ensures the current query completes before plan execution begins
- **Raw Mode Toggle**: Raw mode is disabled during prompts to prevent interference with inquirer's input handling
- **Mode Colors**: Different modes use distinct colors to provide immediate visual feedback

### Future Enhancements
- **Persistent Always Allow List**: Store "Always Allow" decisions in session metadata or user config
- **Per-Tool Permission Profiles**: Allow users to configure default permissions per tool type
- **Permission Audit Log**: Track all permission decisions for security auditing
- **Plan Editing**: Implement the ctrl-g functionality to edit plans in an external editor
- **Permission Presets**: Pre-configured permission profiles for common use cases
- **Tool Risk Classification**: Classify tools by risk level (low, medium, high) and auto-approve low-risk tools

### Dependencies
- **inquirer**: Powers all interactive prompts with list, checkbox, and input types
- **chalk**: Provides terminal color formatting for enhanced UX
- **@anthropic-ai/claude-agent-sdk**: Defines the `CanUseTool` callback interface and SDK integration

### Related Documentation
- Claude Agent SDK documentation for `canUseTool` callback interface
- inquirer documentation for prompt types and configuration
- Node.js TTY and raw mode documentation for terminal control
