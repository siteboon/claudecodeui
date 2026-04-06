# How each session processes sessions
- The way each session processes the sessions is already setup in `server/src/modules/providers`. Port over the existing logic to the new classes if possible. 

# How to start, resume, and stop a session

## Claude
A new session is created by calling `query({ prompt, options })` which yields an async stream of SDK messages.  The session ID can be provided explicitly by using `resume` option and passing the session id (`sdkOptions.resume = sessionId;`).

https://platform.claude.com/docs/en/agent-sdk/typescript#types

Session can be stopped midway using `queryInstance.interrupt()`
 https://platform.claude.com/docs/en/agent-sdk/typescript#methods
 
## Codex
- Starting - `const thread = codex.startThread(threadOptions)`
- Resuming - `codex.resumeThread(sessionId, threadOptions);`
- Stop a session 
	```
	    // Execute with streaming

    const streamedTurn = await thread.runStreamed(command, {

      signal: abortController.signal

    });
	```
### About Abort controllers
- Think of `AbortController` as a **cancel button for async work**.
- **Controller** = thing that sends the cancel command.
- **Signal** = thing that receives or carries the cancel state

```js
const controller = new AbortController();

fetch("https://api.example.com/data", {
  signal: controller.signal
})
  .then(response => response.json())
  .then(data => {
    console.log("Finished:", data);
  })
  .catch(error => {
    if (error.name === "AbortError") {
      console.log("The request was cancelled");
    } else {
      console.error("Real error:", error);
    }
  });

// Cancel it after 2 seconds
setTimeout(() => {
  controller.abort();
}, 2000);
```
- `AbortController` does **not magically stop all JavaScript everywhere**. It only works if the API or function you are using actually supports cancellation via a signal. `fetch` does. Your own custom async functions can too, but you have to write that support yourself. In codex, the method `runStreamed` supports it as well.
```js
function wait(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
  // if signal was aborted EVEN BEFORE the function started, return back.
  // This catches the case where someone did this first:
  // controller.abort("Cancelled already");
  // wait(5000, { signal: controller.signal });
    if (signal?.aborted) {
      reject(signal.reason); // it supports custom reasoning as well.
      return;
    }

    const timeoutId = setTimeout(() => {
      resolve("Done waiting");
    }, ms);
	
	// when the signal.abort event is fired (when controller.abort() is called somewhere else), it sends an `abort` event.
	// When we get this, remove the timeoutId
    signal?.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      reject(signal.reason);
    });
  });
}


// ---------------- USAGE --------------------
const controller = new AbortController();

wait(5000, { signal: controller.signal })
  .then(result => {
    console.log(result);
  })
  .catch(error => {
    console.log("Cancelled:", error);
  });

setTimeout(() => {
  controller.abort("User cancelled the wait");
}, 1000);

```


## Gemini
### Start

spawn `gemini --prompt "actualprompt" --model "actual model", --output-format 'stream-json'`

- Stream `json` output format send responses in terms of a series of `json` chunks. If we store it, we would use .`jsonl` format.
- Allowed tools aren't needed as it's depreciated.
```
      --allowed-tools             [DEPRECATED: Use Policy Engine instead See
                                  https://geminicli.com/docs/core/policy-engine] Tools that are allowed 
                                  to run without confirmation     
```

- `--prompt` allows us to run just one prompt in headless mode. It will automatically trust the workspace directory so it won't ask us whether we trust the workspace or not.

### Stop/Abort a session
```js
try {
	geminiProc.kill('SIGTERM'); // gracefully terminates the process. It ASKS the process to shut down cleanly. The process can catch it, save state, close files, and exit
	setTimeout(() => {
			geminiProc.kill('SIGKILL'); // kills it immediately
		}
	}, 2000); // Wait 2 seconds before force kill

	return true;
} catch (error) {
	return false;
}
```

### resume
- spawn `gemini <the above formats> --resume <sessionId>`

### To receive a response
```
child.stdout.on('data', (chunk) => {
	const text = chunk.toString();
	...
})

child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  ...
}
```

## Cursor
### Start
- spawn `cursor-agent --print --trust --output-format 'stream-json' <actual-prompt'>`
This won't be able to run shell commands like `git init`. To be able to run those, `--yolo` must be passed.

### Resume
- spawn `cursor-agent <above commands> --resume <sessionID>`

### abort
- same approach as gemini.


# How to fetch (list the model types supported for each model...find out if there is an easy way to fetch automatically from the files)

## Claude

`query.supportedModels()` returns `ModelInfo[]`.
```ts
/**
 * Information about an available model.
 */
export declare type ModelInfo = {
    /**
     * Model identifier to use in API calls
     */
    value: string;
    /**
     * Human-readable display name
     */
    displayName: string;
    /**
     * Description of the model's capabilities
     */
    description: string;
    /**
     * Whether this model supports effort levels
     */
    supportsEffort?: boolean;
    /**
     * Available effort levels for this model
     */
    supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
    /**
     * Whether this model supports adaptive thinking (Claude decides when and how much to think)
     */
    supportsAdaptiveThinking?: boolean;
};
```

```
supported models = [
  {
    value: 'default',
    displayName: 'Default (recommended)',
    description: 'Use the default model (currently Sonnet 4.6) · $3/$15 per Mtok',
    supportsEffort: true,
    supportedEffortLevels: [ 'low', 'medium', 'high', 'max' ],
    supportsAdaptiveThinking: true
  },
  {
    value: 'sonnet[1m]',
    displayName: 'Sonnet (1M context)',
    description: 'Sonnet 4.6 for long sessions · $6/$22.50 per Mtok',
    supportsEffort: true,
    supportedEffortLevels: [ 'low', 'medium', 'high', 'max' ],
    supportsAdaptiveThinking: true
  },
  {
    value: 'opus',
    displayName: 'Opus',
    description: 'Opus 4.6 · Most capable for complex work · $5/$25 per Mtok',
    supportsEffort: true,
    supportedEffortLevels: [ 'low', 'medium', 'high', 'max' ],
    supportsAdaptiveThinking: true
  },
  {
    value: 'opus[1m]',
    displayName: 'Opus (1M context)',
    description: 'Opus 4.6 for long sessions · $10/$37.50 per Mtok',
    supportsEffort: true,
    supportedEffortLevels: [ 'low', 'medium', 'high', 'max' ],
    supportsAdaptiveThinking: true
  },
  {
    value: 'haiku',
    displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok'
  },
  {
    value: 'sonnet',
    displayName: 'sonnet',
    description: 'Custom model',
    supportsEffort: true,
    supportedEffortLevels: [ 'low', 'medium', 'high', 'max' ],
    supportsAdaptiveThinking: true
  }
]
```

## Codex

- Found in `.codex/models_cache.json`. It's in the `models` attribute. 
```json
{
	...,
	"models": [
		    {
      "slug": "gpt-5.4",
      "display_name": "gpt-5.4",
      "description": "Latest frontier agentic coding model.",
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [
        {
          "effort": "low",
          "description": "Fast responses with lighter reasoning"
        },
        {
          "effort": "medium",
          "description": "Balances speed and reasoning depth for everyday tasks"
        },
        {
          "effort": "high",
          "description": "Greater reasoning depth for complex problems"
        },
        {
          "effort": "xhigh",
          "description": "Extra high reasoning depth for complex problems"
        }
      ],
      "shell_type": "shell_command",
      "visibility": "list",
      "supported_in_api": true,
      "priority": 1,
      "availability_nux": null,
      "upgrade": null,
      "base_instructions": "...",
      "model_messages": {
        "instructions_template": "...",
        "instructions_variables": {
          "personality_default": "",
          "personality_friendly": "..."
        }
      },
      "supports_reasoning_summaries": true,
      "default_reasoning_summary": "none",
      "support_verbosity": true,
      "default_verbosity": "low",
      "apply_patch_tool_type": "freeform",
      "web_search_tool_type": "text_and_image",
      "truncation_policy": {
        "mode": "tokens",
        "limit": 10000
      },
      "supports_parallel_tool_calls": true,
      "supports_image_detail_original": true,
      "context_window": 272000,
      "effective_context_window_percent": 95,
      "experimental_supported_tools": [],
      "input_modalities": [
        "text",
        "image"
      ],
      "supports_search_tool": true
    },
    {
	    ...
    }
	]
}
```

## Gemini
- There is no way to automatically do this. So, use this 
![[Pasted image 20260401124033.png]]

The above is for free one. The below contains for all.

```
  OPTIONS: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro Experimental' },
    { value: 'gemini-2.0-flash-thinking-exp', label: 'Gemini 2.0 Flash Thinking' }
  ],
```

## Cursor
- spawn `cursor-agent --list-models` and parse the ANSI output.
```js
function parseModelLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed === 'Available models' || trimmed.startsWith('Loading models') || trimmed.startsWith('Tip:')) {
    return null;
  }

  const match = trimmed.match(/^(.+?)\s+-\s+(.+)$/);
  if (!match) {
    return null;
  }

  const name = match[1].trim();
  let description = match[2].trim();
  const current = /\(current\)/i.test(description);
  const defaultModel = /\(default\)/i.test(description);

  description = description.replace(/\s*\((current|default)\)/gi, '').replace(/\s{2,}/g, ' ').trim();

  return {
    name,
    description,
    current,
    default: defaultModel,
  };
}

function parseModelsOutput(text) {
  const models = [];

  for (const line of stripAnsi(text).split(/\r?\n/)) {
    const parsed = parseModelLine(line);
    if (parsed) {
      models.push(parsed);
    }
  }

  return models;
}


// ------------ tHE ABOVE RETURNS ------------
[
  {
    "name": "auto",
    "description": "Auto",
    "current": true,
    "default": false
  },
  {
    "name": "composer-2-fast",
    "description": "Composer 2 Fast",
    "current": false,
    "default": true
  },
  {
    "name": "composer-2",
    "description": "Composer 2",
    "current": false,
    "default": false
  },
  ...
]
```

# How to fetch session history
- In the sessions table, there is a `jsonl_path` column. Go to directly that and parse the JSONLs from there. For `gemini`, the `jsonl_path` actually points to a gemini JSON file (since Gemini stores information in JSON rather than JSONL). DON'T use the LEGACY fetcher.

# How to search conversations for each provider
- Go to all the JSONL path directories from the database and use `@vscode/ripgrep` library for searching something.


# How to change thinking modes for each model
## Claude
- Passed through `query` options through `effort: <'low' | 'medium' | 'high' | 'max'>`

Default is high.

## Codex
- passed through `threadOptions`

```

type ModelReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

type ThreadOptions = {
    model?: string;
    sandboxMode?: SandboxMode;
    workingDirectory?: string;
    skipGitRepoCheck?: boolean;
    modelReasoningEffort?: ModelReasoningEffort;
    networkAccessEnabled?: boolean;
    webSearchMode?: WebSearchMode;
    webSearchEnabled?: boolean;
    approvalPolicy?: ApprovalMode;
    additionalDirectories?: string[];
};


```
- `minimal` is supported only by `GPT-5`

## Gemini
- Not changeable. We can only select the different providers that have different thinking levels by themselves.

## Cursor
- Same as gemini. 


# How to set/change models at start/after a session response respectively?
## Claude
- Initially can be set at start using `queryOptions.model`
- Just resume the session by updating the model in `threadoptions`

## Codex
- Same as claude

## Gemini
- Just add the `--model <model-name>` property in the new spawned command. If there is something to resume, add `--resume <sessionID>`
## Cursor
- Just add the `--model <model-name>` property in the new spawned command. If there is something to resume, add `--resume <sessionID>`. In other words, same as gemini.

