# Implement Slash Commands for Claude Code Web UI

## Backend Implementation (server/routes/commands.js)

### 1. Create Commands API Router
- **POST `/api/commands/list`**: Scan and return all available commands
  - Scan `.claude/commands/` in project directory
  - Scan `~/.claude/commands/` for user-level commands
  - Recursively traverse directories for nested commands
  - Return flat list with metadata: `{ name, path, description, namespace }`

- **POST `/api/commands/load`**: Load specific command content
  - Read markdown file
  - Parse frontmatter metadata (description, allowed-tools, model)
  - Return raw content and metadata

- **POST `/api/commands/execute`**: Process command for execution
  - Replace `$ARGUMENTS` with provided arguments
  - Replace `$1`, `$2`, etc. with positional arguments
  - Handle `@filename` file includes
  - Handle `!command` bash execution
  - Return processed content to inject as system prompt

### 2. Built-in Commands Handler
- Implement handlers for each built-in command:
  - `/help`: Return help documentation
  - `/clear`: Signal to clear chat history (frontend handles)
  - `/model`: List/switch available models
  - `/cost`: Return current token usage stats
  - `/memory`: Open/edit CLAUDE.md
  - `/config`: Return current config (frontend opens settings)
  - `/status`: Return version, model, account info
  - `/rewind`: Handle conversation rewind

## Frontend Implementation (src/components/ChatInterface.jsx)

### 3. Command Discovery on Mount
- Fetch commands list on component mount/project change
- Store in `slashCommands` state
- Include built-in commands + custom commands

### 4. Input Handler for Slash Detection
- Monitor textarea input changes
- Detect when user types `/` at start of input or after space
- Extract command query (text after `/` until space/end)
- Filter `slashCommands` based on query
- Update `filteredCommands` and `showCommandMenu` states
- Track cursor position for dropdown placement

### 5. Command Autocomplete UI
- Render dropdown menu below cursor when `showCommandMenu === true`
- Display filtered commands with:
  - Command name (bold)
  - Description/namespace (gray text)
  - Keyboard shortcut hint
- Implement keyboard navigation:
  - ArrowUp/ArrowDown: Navigate commands
  - Enter: Select command
  - Escape: Close menu
  - Tab: Autocomplete first match
- Implement mouse hover/click selection

### 6. Command Execution Flow
- When command selected:
  - Extract command name and arguments from input
  - Call `/api/commands/execute` with command + args
  - For built-in commands that need special handling:
    - `/clear`: Clear `chatMessages` state
    - `/config`: Open settings modal
    - `/memory`: Open file editor for CLAUDE.md
  - For regular commands:
    - Get processed content from API
    - Inject as system message/context
    - Send to Claude with modified prompt
- Clear input and close menu after execution

### 7. Special Command Handling
- **`/clear`**: Reset chat state immediately (no API call)
- **`/config`**: Toggle settings modal
- **`/model`**: Show model selection UI
- **`/cost`**: Display token usage overlay/modal
- **Commands with bash (`!`)**: Show confirmation before execution
- **Commands with file refs (`@`)**: Show file preview before sending

## Additional Features

### 8. Command Hints
- Show placeholder text: "Type / for commands" when input empty
- Show command count badge in UI
- Add `/` button next to send button to open command list

### 9. MCP Commands Integration
- Query MCP servers for available prompts
- Add to commands list with `/mcp__` prefix
- Handle MCP prompt execution via MCP tool

### 10. Error Handling
- Handle missing command files gracefully
- Show error if command file not found
- Validate command syntax before execution
- Prevent recursive file includes
- Timeout for bash command execution

## Files to Create/Modify

**New Files:**
- `server/routes/commands.js` - Commands API routes
- `server/utils/commandParser.js` - Parse markdown, replace variables
- `src/components/CommandMenu.jsx` - Autocomplete dropdown UI (optional)

**Modified Files:**
- `server/index.js` - Add commands router
- `src/components/ChatInterface.jsx` - Input handling, command execution
- Add command execution to WebSocket message flow

## Testing Checklist
- [ ] Built-in commands work (/help, /clear, /model, etc.)
- [ ] Custom commands from `.claude/commands/` load correctly
- [ ] Nested directory commands work (e.g., `/tm/next/next-task`)
- [ ] Arguments replacement works ($ARGUMENTS, $1, $2)
- [ ] Autocomplete filters correctly as user types
- [ ] Keyboard navigation works (arrows, Enter, Escape)
- [ ] Mouse selection works
- [ ] Bash execution with `!` works safely
- [ ] File includes with `@` work
- [ ] MCP commands appear and execute
- [ ] Command menu closes on selection/escape
- [ ] Works across different projects
