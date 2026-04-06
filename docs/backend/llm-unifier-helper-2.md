# How each provider supports image uploading

Universally: First, we should upload the images in `.cloudcli/assets` folder. Then,  it should just reference that path later on.

## Claude
- When clicking send, attach the images in the content list with the type of 'image'.
- https://platform.claude.com/docs/en/api/messages#message_param
```js
  const imageBytes = await fs.readFile(imagePath);
  const sdkPrompt = (async function*: AsyncIterable<SDKUserMessage> () {
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: imageBytes.toString('base64'),
            },
          },
        ],
      },
      parent_tool_use_id: null,
      timestamp: new Date().toISOString(),
    };
  })(); // automatically executed because of the `()` in the end.
```

### Some useful types
```ts
export interface MessageParam {
  content: string | Array<ContentBlockParam>;

  role: 'user' | 'assistant'; // when we send the message for prompting, the role will be 'user'
}

/**
 * Regular text content.
 */
export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | DocumentBlockParam
  | SearchResultBlockParam
  | ThinkingBlockParam
  | RedactedThinkingBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ServerToolUseBlockParam
  | WebSearchToolResultBlockParam;
  
  
export interface TextBlockParam {
  text: string;
  type: 'text';
}

export interface ImageBlockParam {
  source: Base64ImageSource | URLImageSource; // I'll be using only base 64 for now.
  type: 'image';
}

export interface Base64ImageSource {
  data: string;
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  type: 'base64';
}
```

### Explanations about async generators and yield
To understand why `async function*` is used, it helps to stop thinking of functions as "machines that run and finish" and start thinking of them as **"factories that stay open."** 
```ts
async function* getTaskStatus(): AsyncIterable<string> {
  yield "Checking permissions..."; 
  await new Promise(r => setTimeout(r, 500)); // Simulate work

  yield "Searching database...";
  await new Promise(r => setTimeout(r, 500));

  yield "Formatting prompt...";
}

// CONSUMPTION
async function run() {
  const statusGenerator = getTaskStatus();

  for await (const status of statusGenerator) {
    console.log(`Current Status: ${status}`);
  }
  
  console.log("Done!");
}
```

## Codex
```ts
const streamed = await thread.runStreamed([ {type: "text", text: "Describe this image:"}, {type: "local_image", path: "scripts/pic.jpg"}
```
- Don't add the above query lines for codex. We can directly use the `sdk`.

## Gemini and Cursor
- Just add the path to the end of the prompt when clicking send for paths including images. For e.g. 
```
<some-user-prompt>

<images_input>
---- IGNORE THE <images_input> QUERY LINES. Just use the attached list of an array of paths for images below and use it with the above prompt.

["scripts\pic.jpg", "<path-for-second-image>", ...]
```



# MCP servers (how to add/remove one and run it)

**What is the Model Context Protocol (MCP)?**
Think of MCP as the USB-C cable for AI.
- Historically, if you wanted an AI model to read your GitHub repository, query your database, or search your company's Notion workspace, developers had to write custom, one-off integrations for every single AI tool.
- Created by Anthropic as an open-source standard, the Model Context Protocol fixes this. It is a universal language that allows AI applications (the "clients") to securely connect to external data sources and tools (the "servers") using a single, unified protocol.

**What is an MCP Server?**
- If MCP is the USB-C cable, an **MCP Server** is the hard drive or webcam you are plugging in.
- It is a lightweight program that acts as a secure bridge between your specific data and the AI. When the AI needs context—like checking the current state of a file or executing a search—it asks the MCP server. The server translates the AI's request, securely fetches the data or performs the action, and hands the result back to the AI.

 **Different  transport mechanisms for MCP servers**
1. `stdio` - This is the default and most common transport for local development. When using `stdio`, the AI client directly launches the MCP server as a background "child process" on your machine. The client and server then talk to each other locally by writing to and reading from standard input (`stdin`) and standard output (`stdout`).
	- **Clear Example:** A local **File System Server**. You want the AI to read your local `package.json` file. The AI client spawns the file system server via `stdio`. Because the server is running locally on your hardware, it inherently has access to your files without needing complex authentication. It reads the file and prints the contents back to the AI.
2. `https` (Streamable HTTP) - Streamable HTTP replaces older remote methods. It uses a single HTTP or HTTPS endpoint for bidirectional communication. The client sends standard `POST` requests, and the server can respond instantly or keep the connection open to stream data back. It behaves exactly like a modern web API. Because it runs over HTTP, it supports standard web security features like OAuth, Bearer tokens, and CORS.
	- **Clear Example:** A **Cloud Database Server**. If you work on a team and want everyone's AI to be able to query a shared staging database, you would deploy an MCP server to the cloud. Your AI connects to `https://api.yourcompany.com/mcp` using Streamable HTTP and passes an API key in the headers to securely run queries.
3. `sse` (Server sent events) - SSE is the legacy transport mechanism for remote servers. While still widely supported, it is actively being phased out in favor of Streamable HTTP because it is slightly more cumbersome to build and maintain.
	- **How it works:** Unlike Streamable HTTP which uses a single unified endpoint, SSE requires _two_ distinct network connections. The client connects to an SSE endpoint (via an HTTP `GET` request) strictly to listen for incoming messages from the server, and uses a separate HTTP `POST` endpoint to send messages to the server.
    
- **Clear Example:** An older **Slack Integration Server**. The AI client connects to the server's SSE stream to listen for real-time incoming messages from a Slack channel. When the AI wants to reply, it sends a payload to a separate `/message` POST endpoint.

**Frontend coordination**
- When listing the MCP servers for a provider, go to the appropriate files where the configuration is stored to fetch all of them. When listing, the User/Local/Project MCPs should be grouped separately. 
- To add/remove an MCP server, go to the appropriate file and add/remove it there keeping in mind whether it is configured as User/Local/Project. 
- To update the server, go to the appropriate file and update it from there.
- There should also be one big mcp adder that supports `http` and `stdio` only. When it's added from there, the server will automatically be added to every provider.

## Claude
Supports all 3 transports.
### `stdio`
- We can have arguments and env variables input when executing the command.
- `args` and `env` are optional.
```json
{
  "mcpServers": {
    "local-weather": {
      "type": "stdio",
      "command": "/path/to/weather-cli",
      "args": ["--api-key", "abc123"],
      "env": {
        "CACHE_DIR": "/tmp"
      }
    }
  }
}
```

### `http`
- We don't pass `env` inputs for now. It's supported but we will add it only later.
- `headers` is optional.
```json
{
  "mcpServers": {
    "weather-api": {
      "type": "http",
      "url": "https://api.weather.com/mcp",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

### `sse`
- similar with `http` format.
```json
{
  "mcpServers": {
	"private-api": {
	  "type": "sse",
	  "url": "https://api.company.com/sse",
	  "headers": {
		"X-API-Key": "your-key-here"
		}
	}
  }
}
```

### Support for different modes (Local, user, project)

#### Local
- stored in `~/.claude.json` under the project’s path.
#### User
- stored in `~/.claude.json` under the main object with the key `"mcpServers"
#### Project specific
- add it in the `.mcp.json` file in the project root directory.

## Codex

### Configuration (Only `stdio` and `http` are supported.)

#### `stdio`
- `command` (required): The command that starts the server.
- `args` (optional): Arguments to pass to the server.
- `env` (optional): Environment variables to set for the server.
- `env_vars` (optional): Environment variables to allow and forward.
- `cwd` (optional): Working directory to start the server from.

```toml
[mcp_servers.my_stdio]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.my_stdio.env]
API_KEY = "your-key"
```

With forwarded host env vars.
```toml
[mcp_servers.my_stdio]
command = "python"
args = ["server.py"]
env_vars = ["API_KEY", "DEBUG"]
cwd = "/path/to/project"
```
#### `http`
- `url` (required): The server address.
- `bearer_token_env_var` (optional): Environment variable name for a bearer token to send in `Authorization`.
- `http_headers` (optional): Map of header names to static values.
- `env_http_headers` (optional): Map of header names to environment variable names (values pulled from the environment).
```toml
[mcp_servers.my_http]
url = "https://example.com/mcp"
bearer_token_env_var = "MY_API_TOKEN"
http_headers = { "X-Custom-Header" = "custom-value" }
env_http_headers = { "X-Api-Key" = "MY_API_KEY_ENV" }
```

### Support for different modes (user, project)
#### User
- add it to the global `~/.codex/config.toml` file.

#### Project specific
- add it in `.codex/config.toml` file in the project's root directory.

## Gemini
Supports all 3 transports.
### `stdio`
- We can have arguments and env variables as inputs when executing the command.
- `args` and `env` are optional.
- No `type` attribute like Claude for `stdio`. If there is no type, we can infer that it must be `stdio` since the rest have it.
```json

{
  "mcpServers": {
    "serverName": {
      "command": "path/to/server",
      "args": ["--arg1", "value1"],
      "env": {
        "API_KEY": "$MY_API_TOKEN"
      },
      "cwd": "./server-directory"
    }
  }
}
```

### `http`
- We don't pass `env` inputs. Notice the type is set here like Claude. 
- `headers` is optional. 
- EXACTLY same as Claude `http`.
```json
{
  "mcpServers": {
    "weather-api": {
      "type": "http",
      "url": "https://api.weather.com/mcp",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

### `sse`
- similar with `http` format. 
- EXACT with Claude `sse` format.
```json
{
  "mcpServers": {
	"private-api": {
	  "type": "sse",
	  "url": "https://api.company.com/sse",
	  "headers": {
		"X-API-Key": "your-key-here"
		}
	}
  }
}
```

### Support for different modes (user, project)

#### User
- stored in `~/.gemini/settings.json`.

#### Project specific
- add it in the `.gemini/settings.json` file in the project root directory.



## Cursor

Supports all 3 transports. There is no `type` attribute for all 3. Here are the structures:

#### `stdio`
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "mcp-server"],
      "env": {
        "API_KEY": "value"
      }
    }
  }
}
```

#### `http` / `sse` 
```json
// MCP server using HTTP or SSE - runs on a server
{
  "mcpServers": {
    "server-name": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "API_KEY": "value"
      }
    }
  }
}
```


### Support for different modes (user, project)

#### User
- stored in `~/.cursor/mcp.json`.

#### Project specific
- add it in the `.cursor/mcp.json` file in the project root directory.




# Skills management (ONLY Fetching support needed for now)
## Claude
- To get user skills, fetch all `~/.claude/skills/<skill-name>/SKILL.md`.
- To get project skills, fetch from `.claude/skills/<skill-name>/SKILL.md`. 
- To get plugin skills:
	- Find all the enabled plugins in `~/.claude/settings.json`. 
	```json
	{
	  "apiKeyHelper": "...",
	  "enabledPlugins": {
		"example-skills@anthropic-agent-skills": true
	  },
	  ...
	}
	```
	- Then go to `~/.claude/plugins/installed_plugins.json` file to find where the plugin is installed. 
	```json
	{
	  "version": 2,
	  "plugins": {
	    "example-skills@anthropic-agent-skills": [
	      {
	        "scope": "user",
	        "installPath": "C:\\Users\\OMEN6\\.claude\\plugins\\cache\\anthropic-agent-skills\\example-skills\\3d5951151859",
	        "version": "3d5951151859",
	        "installedAt": "2026-03-03T12:52:08.024Z",
	        "lastUpdated": "2026-03-03T12:52:08.024Z",
	        "gitCommitSha": "3d59511518591fa82e6cfcf0438d68dd5dad3e76"
	      }
	    ]
	  }
	}
	```
	- Then go the `installPath` directory. If there is a `skills` folder there, go to each of the skills in `<install-path>/skills/<skill-name>/SKILL.md`.

Then, parse the name and description of the skills from the md for every `SKILL.md`.

- The command for invoking skills is `/<skill-name>` . 

- Whenever a skill is from a plugin, doing `/skill-name` should automatically be updated with `/plugin-name:skill-name`. This is because plugin skills use a `plugin-name:skill-name` namespace, so they cannot conflict with other levels.

I have attached the first initial contents of a sample `SKILL.md` file below.

```md
---

name: mcp-builder

description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services, whether in Python (FastMCP) or Node/TypeScript (MCP SDK).

license: Complete terms in LICENSE.txt

---
```
## Codex


Codex reads skills from repository, user, admin, and system locations.


| Skill Scope | Location                                                                                                | Suggested use                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REPO`      | `$CWD/.agents/skills`  <br>Current working directory: where you launch Codex.                           | If you’re in a repository or code environment, teams can check in skills relevant to a working folder. For example, skills only relevant to a microservice or a module.                              |
| `REPO`      | ` $CWD/../.agents/skills`  <br>A folder above CWD when you launch Codex inside a Git repository.        | If you’re in a repository with nested folders, organizations can check in skills relevant to a shared area in a parent folder.                                                                       |
| `REPO`      | `$REPO_ROOT/.agents/skills`  <br>The topmost root folder when you launch Codex inside a Git repository. | If you’re in a repository with nested folders, organizations can check in skills relevant to everyone using the repository. These serve as root skills available to any subfolder in the repository. |
| `USER`      | `$HOME/.agents/skills`  <br>Any skills checked into the user’s personal folder.                         | Use to curate skills relevant to a user that apply to any repository the user may work in.                                                                                                           |
| `ADMIN`     | `/etc/codex/skills`  <br>Any skills checked into the machine or container in a shared, system location. | Use for SDK scripts, automation, and for checking in default admin skills available to each user on the machine.                                                                                     |
| `SYSTEM`    | `~/.codex/skills/.system`                                                                               | Useful skills relevant to a broad audience such as the skill-creator and plan skills. Available to everyone when they start Codex.                                                                   |

Then, parse the name and description of the skills from the md for every `SKILL.md`.

- The command for invoking skills is `$<skill-name>`
## Gemini
- Gets all skills from `~/.gemini/skills`, `~/.agents/skills`, `.gemini/skills`, `.agents/skills`
- command for invoking skills is same as Claude.


## Cursor
[Skill directories](https://cursor.com/docs/skills?utm_source=chatgpt.com#skill-directories)
Skills are automatically loaded from these locations:

|Location|Scope|
|---|---|
|`.agents/skills/`|Project-level|
|`.cursor/skills/`|Project-level|
|`~/.cursor/skills/`|User-level (global)|
Then, parse the name and description of the skills from the md for every `SKILL.md`.

- command for invoking skills is same as Claude.
