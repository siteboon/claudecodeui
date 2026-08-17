# ZCode Provider User Guide

**Complete guide to using ZCode as a provider in CloudCLI**

## Table of Contents

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Basic Usage](#basic-usage)
5. [Advanced Features](#advanced-features)
6. [Troubleshooting](#troubleshooting)
7. [Integration with Desktop ZCode](#integration-with-desktop-zcode)

---

## 1. Introduction

ZCode (Z.ai's GLM-powered coding agent) is now available as a provider in CloudCLI, giving you access to advanced AI coding assistance with powerful reasoning capabilities and comprehensive tool integration.

### Key Features

- **Advanced Reasoning:** GLM-5.3 model with multi-level reasoning (high/low/max)
- **Tool Integration:** Comprehensive file operations, command execution, and development tools
- **Session Management:** Persistent conversations with history and context
- **Desktop Integration:** Seamless session sharing with ZCode desktop application
- **MCP Support:** Model Context Protocol for extensibility
- **Skills System:** Custom agent skills for specialized tasks

### Model Capabilities

**GLM-5.3 (Default Model):**
- Context Window: 1M tokens
- Maximum Output: 128K tokens
- Reasoning Variants: High, Low, Max
- Native Tools: File operations, command execution, web browsing, code analysis

---

## 2. Installation

### 2.1 Installing ZCode

ZCode provider requires the ZCode desktop application or CLI to be installed on your system.

#### macOS Installation

1. Download ZCode from [z.ai](https://z.ai)
2. Install the application: `ZCode.app`
3. Verify installation: `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs --version`

#### Linux Installation

1. Download ZCode from [z.ai](https://z.ai)
2. Install to `/usr/local/bin/zcode` or equivalent location
3. Verify installation: `zcode --version`

#### Windows Installation

1. Download ZCode from [z.ai](https://z.ai)
2. Install to `%LOCALAPPDATA%\Programs\ZCode\`
3. Verify installation through Command Prompt

### 2.2 Authenticating with ZCode

After installation, you need to authenticate your ZCode account:

```bash
# Find your ZCode installation path
# On macOS:
/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs login

# On Linux:
zcode login

# The login command will open a browser for OAuth authentication
```

### 2.3 Verifying Installation in CloudCLI

Once ZCode is installed and authenticated, CloudCLI will automatically detect it:

1. Open CloudCLI
2. Go to provider selection (empty state or settings)
3. ZCode should appear as an available provider
4. The interface will show your authentication status

---

## 3. Configuration

### 3.1 Selecting ZCode as Your Provider

1. **From Empty State:**
   - Click "ZCode" in the provider selection panel
   - If not authenticated, follow the login guidance
   - Start your conversation

2. **From Settings:**
   - Open CloudCLI settings
   - Navigate to "Provider" section
   - Select "ZCode" from the dropdown
   - Choose your preferred model and settings

### 3.2 Model Selection

**Available Models:**
- **GLM-5.3 (Default):** Main production model with full capabilities
- **GLM-5.3-Lite:** Faster responses with reduced capabilities (if available)

**Reasoning Effort Levels:**
- **Max:** Deep reasoning for complex problems (default)
- **High:** Balanced reasoning for most tasks
- **Low:** Quick reasoning for simple requests

### 3.3 Permission Modes

Choose how ZCode interacts with your system:

| Mode | Description | Use Case |
|------|-------------|----------|
| **default** | Standard build mode | Everyday development tasks |
| **acceptEdits** | Edit-focused mode | Code refactoring and modifications |
| **plan** | Planning mode | Architecture design and planning |
| **bypassPermissions** | Yolo mode | Automated operations with minimal prompts |
| **auto** | Adaptive mode | Let ZCode choose appropriate permissions |

### 3.4 Configuration Files

#### Project Configuration (`zcode.json`)

Create project-specific configuration in your workspace root:

```json
{
  "hooks": {
    "pre-sessions": ["npm install"],
    "post-sessions": ["git status"]
  },
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"]
      }
    }
  }
}
```

#### User Configuration (`~/.zcode/cli/config.json`)

Global settings for all sessions:

```json
{
  "model": {
    "main": {
      "providerId": "builtin:bigmodel-coding-plan",
      "modelId": "GLM-5.3",
      "variant": "max"
    }
  },
  "permission": {
    "mode": "build"
  }
}
```

### 3.5 Environment Variables

Configure ZCode behavior through environment variables:

```bash
# Specify ZCode engine path (development)
export CLOUDCLI_ZCODE_ENGINE="/path/to/zcode.cjs"

# Change ZCode data directory (isolation)
export ZCODE_STORAGE_DIR="/custom/zcode/storage"

# Credentials directory (advanced)
export ZCODE_DATA_BASE_DIR="/custom/credentials"
```

---

## 4. Basic Usage

### 4.1 Starting a ZCode Session

1. **New Conversation:**
   - Click "New Chat" or similar action
   - Select "ZCode" as your provider
   - Start typing your request

2. **Continue Existing Session:**
   - Select a previous ZCode conversation from sidebar
   - Continue the conversation with new requests

### 4.2 Interacting with ZCode

**Basic Prompt Examples:**

```
"Help me refactor this function to be more efficient"
"Explain how this authentication system works"
"Write tests for this API endpoint"
"Debug this error I'm getting when running the tests"
```

**Advanced Prompt Examples:**

```
"Analyze this codebase and suggest architectural improvements"
"Implement a new feature following these specifications:..."
"Review this pull request and identify potential issues"
"Help me optimize this database query"
```

### 4.3 Using Tools and Capabilities

ZCode has access to various tools that it can use to help you:

- **File Operations:** Read, write, and analyze code files
- **Command Execution:** Run terminal commands and scripts
- **Web Browsing:** Search and access online resources
- **Code Analysis:** Understand and manipulate code structures
- **Testing:** Run and debug tests

**Example Tool Usage:**

```
"Read the package.json file and update the dependencies"
"Run the test suite and show me the failing tests"
"Search for information about this error message"
```

### 4.4 Managing Sessions

**Session Features:**
- **History:** All conversations are persisted and searchable
- **Context:** ZCode maintains context throughout the conversation
- **Branching:** Create alternative conversation paths
- **Export:** Save conversations for documentation or sharing

---

## 5. Advanced Features

### 5.1 MCP (Model Context Protocol)

Extend ZCode capabilities with MCP servers:

**Setting up MCP Servers:**

In your project `zcode.json`:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
      },
      "database": {
        "command": "npx", 
        "args": ["-y", "@modelcontextprotocol/server-postgres", "connection-string"]
      }
    }
  }
}
```

**Using MCP Tools:**

```
"Use the filesystem server to analyze the project structure"
"Query the database using the database MCP server"
```

### 5.2 Custom Skills

Create custom skills for specialized tasks:

**Skill Structure:**
```
.your-project/
├── .agents/
│   └── skills/
│       └── your-skill/
│           ├── SKILL.md
│           ├── package.json
│           └── implementation.ts
```

**Using Custom Skills:**

```
"Use /your-skill to process this data"
"Help me with /your-skill for this specific task"
```

### 5.3 Session Sharing with Desktop ZCode

ZCode sessions created in CloudCLI are automatically visible in the ZCode desktop application, and vice versa:

**Benefits:**
- Start a conversation in CloudCLI, continue in desktop app
- Access desktop sessions from CloudCLI
- Share context across interfaces
- Unified experience across platforms

**Configuration for Isolation:**

If you want to keep CloudCLI and desktop sessions separate:

```bash
export ZCODE_STORAGE_DIR="/custom/path/cloudcli-zcode"
```

### 5.4 Advanced Reasoning Controls

**Reasoning Effort Levels:**

```
"Use high reasoning effort to solve this complex problem"
"Use low reasoning effort for this simple task"
"Use max reasoning for this architectural design"
```

**Context Management:**

```
"Focus on this specific file only"
"Consider the entire project context"
"Ignore these files in your analysis"
```

---

## 6. Troubleshooting

### 6.1 Installation Issues

**ZCode Not Detected:**

```bash
# Verify installation
/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs --version

# Manual override
export CLOUDCLI_ZCODE_ENGINE="/path/to/zcode.cjs"
```

**Authentication Problems:**

```bash
# Re-authenticate
zcode login

# Check authentication status
zcode auth status
```

### 6.2 Session Issues

**Sessions Not Appearing:**

1. Check that ZCode is running (desktop app or CLI)
2. Verify data directory permissions
3. Check SQLite database accessibility

**History Not Loading:**

1. Restart CloudCLI
2. Verify SQLite database file integrity
3. Check data directory permissions

### 6.3 Performance Issues

**Slow Responses:**

1. Check network connectivity
2. Reduce reasoning effort level
3. Clear session history if very large

**Memory Issues:**

1. Reduce session context size
2. Clear old sessions
3. Check system resources

### 6.4 Error Messages

**Common Error Solutions:**

- "ZCode not found": Install or specify engine path
- "Authentication required": Run `zcode login`
- "Session not accessible": Check ZCode is running
- "Configuration error": Validate zcode.json syntax
- "Permission denied": Check file system permissions

### 6.5 Getting Help

**Resources:**
- [Z.ai Documentation](https://z.ai/docs)
- [CloudCLI Documentation](./README.md)
- [Integration Plan](./zcode-integration-plan.md)
- Community support forums

---

## 7. Integration with Desktop ZCode

### 7.1 Session Synchronization

**How It Works:**

ZCode uses a shared SQLite database (`~/.zcode/cli/db/db.sqlite`) that both CloudCLI and the desktop application access:

- **Shared Storage:** Both interfaces see the same sessions
- **Real-time Updates:** Changes appear in both interfaces
- **Unified Experience:** Seamlessly switch between interfaces

### 7.2 Benefits of Integration

**Start in CloudCLI, Continue in Desktop:**

1. Begin a coding session in CloudCLI's terminal interface
2. Switch to desktop ZCode for visual debugging
3. Return to CloudCLI for command-line operations
4. Maintain full conversation context throughout

**Desktop Sessions in CloudCLI:**

1. Create sessions in desktop ZCode for visual tasks
2. Access those same sessions from CloudCLI
3. Continue with command-line workflows
4. Leverage both interfaces' strengths

### 7.3 Configuration Options

**Shared Mode (Default):**

Both CloudCLI and desktop ZCode access the same session database at `~/.zcode/cli/db/db.sqlite`.

**Isolated Mode:**

```bash
export ZCODE_STORAGE_DIR="/custom/path/cloudcli-sessions"
```

This creates separate session databases for CloudCLI and desktop ZCode.

### 7.4 Best Practices

**When to Use CloudCLI:**
- Command-line heavy workflows
- Automated scripting
- Server environments
- Terminal-based development

**When to Use Desktop:**
- Visual debugging and inspection
- File management operations
- GUI-requiring tasks
- Interactive development

**Workflow Optimization:**
1. Use CloudCLI for quick tasks and automation
2. Switch to desktop for complex visual work
3. Leverage session continuity across interfaces
4. Choose the right tool for each task

---

## 8. Tips and Best Practices

### 8.1 Prompt Engineering

**Effective Prompts:**

- Be specific about what you want
- Provide relevant context upfront
- Use examples when helpful
- Break complex tasks into steps

**Example Structure:**

```
"I need to [task]. Here's the context: [details]. 
Please [specific action]. The constraints are: [requirements]."
```

### 8.2 Session Management

**Best Practices:**

- Create focused sessions for specific tasks
- Use descriptive titles for sessions
- Archive old sessions to keep interface clean
- Export important conversations

### 8.3 Performance Optimization

**For Faster Responses:**

- Use lower reasoning effort for simple tasks
- Keep sessions focused on specific topics
- Limit file context when possible
- Use project configuration effectively

**For Complex Problems:**

- Use max reasoning effort
- Provide comprehensive context
- Break into sub-problems
- Use planning mode for architecture

### 8.4 Security Considerations

**Best Practices:**

- Review tool execution requests
- Be cautious with file operations
- Use appropriate permission modes
- Keep credentials secure
- Review MCP server configurations

---

## 9. Advanced Configuration Examples

### 9.1 Complete Project Configuration

```json
{
  "hooks": {
    "pre-sessions": [
      "npm install",
      "git pull origin main"
    ],
    "post-sessions": [
      "git add .",
      "git commit -m 'AI-assisted changes'"
    ]
  },
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
      },
      "postgres": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."]
      },
      "browser": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-browser"]
      }
    }
  },
  "permission": {
    "mode": "build"
  }
}
```

### 9.2 Development Environment Setup

```bash
# .env or shell configuration
export CLOUDCLI_ZCODE_ENGINE="/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"
export ZCODE_STORAGE_DIR="$HOME/development/zcode-workspace"
export NODE_ENV="development"
```

### 9.3 CI/CD Integration

```bash
# In your CI/CD pipeline
export CLOUDCLI_ZCODE_ENGINE="/usr/local/bin/zcode"
export ZCODE_STORAGE_DIR="/tmp/ci-zcode-sessions"

cloudcli --provider zcode --model "GLM-5.3" --effort "low" <<EOF
Review this PR and run tests
EOF
```

---

## 10. Frequently Asked Questions

**Q: Can I use ZCode without the desktop application?**  
A: Yes, ZCode CLI works independently once installed and authenticated.

**Q: Are my sessions private?**  
A: Sessions are stored locally in your ZCode data directory. You can isolate CloudCLI sessions if needed.

**Q: Can I use multiple providers in the same workflow?**  
A: Yes, you can switch between providers for different tasks, maintaining separate sessions.

**Q: How much does ZCode cost?**  
A: Check [z.ai/pricing](https://z.ai/pricing) for current pricing information.

**Q: Can I use custom models with ZCode?**  
A: ZCode supports custom model providers through its configuration system. See ZCode documentation for details.

---

## 11. Additional Resources

- [ZCode Official Documentation](https://z.ai/docs)
- [CloudCLI Documentation](./README.md)
- [Integration Technical Details](./zcode-provider-developer-notes.md)
- [Provider Development Guide](./coding-agent-integration-guide.md)
- [Community Forums](https://community.z.ai)

---

**Last Updated:** 2026-08-17  
**Version:** 1.0.0  
**Provider Version:** ZCode CLI 0.16.3 / Desktop 3.7.7