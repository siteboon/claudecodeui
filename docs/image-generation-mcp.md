# Optional image generation over MCP

CloudCLI includes an opt-in, project-scoped stdio MCP server for generating and
reopening images. It does not configure providers or change tool approvals for you.
The web server never calls the image provider: it only reads saved job metadata.

## Configure a server for one project

After installing a release containing this feature, add a stdio server named
`image_generation` in your MCP client's **private configuration for this project**:

~~~json
{
  "mcpServers": {
    "image_generation": {
      "command": "cloudcli-image-mcp",
      "args": ["--project", "/absolute/path/to/project"],
      "env": {
        "CLOUDCLI_IMAGE_MODEL": "your-image-model-or-deployment",
        "CLOUDCLI_IMAGE_API_KEY": "SET_PRIVATELY"
      }
    }
  }
}
~~~

Keep the API key in private MCP settings or a securely supplied client environment;
do not commit it to shared project configuration. Register this server only for the
project named by `--project`. The image provider and project cannot be changed through
tool arguments. The MCP process must run on the CloudCLI host with access to that
same project directory. On Windows, absolute paths such as `C:/Projects/demo` work.

For a source checkout, run `npm run build` and use `node` as the MCP command with
`/absolute/checkout/dist-server/server/modules/image-generation/image-generation.cli.js`
as the first argument, followed by `--project` and the project directory.

| Environment setting | Purpose |
| --- | --- |
| `CLOUDCLI_IMAGE_MODEL` | Required image model/deployment; independent of the chat model. |
| `CLOUDCLI_IMAGE_API_KEY` | Required only for new generations. |
| `CLOUDCLI_IMAGE_ENDPOINT` | Full compatible Images API URL; defaults to `https://api.openai.com/v1/images/generations`. |
| `CLOUDCLI_IMAGE_AUTH_MODE` | `bearer` (default) or `api-key` header authentication. |
| `CLOUDCLI_IMAGE_TIMEOUT_MS` | Provider deadline, default 120000, at most 300000 milliseconds. |
| `CLOUDCLI_IMAGE_DATA_DIR` | Private, persistent job store; defaults to `~/.cloudcli/image-generation`. |

The initial adapter posts one prompt-based PNG request to an OpenAI-compatible
Images API returning `data[0].b64_json`. It sends `model`, the unchanged `prompt`,
`n: 1` and `output_format: "png"`, plus optional `size` and `quality`. It does not
send the legacy `response_format` parameter. URL-only responses, editing, reference
images, streaming, SVG and GIF generation are outside this first implementation.
Other providers can implement the internal `ImageGenerationProvider` contract.

The endpoint must use HTTPS; HTTP is accepted only on loopback for local providers
and tests. Redirects are not followed. API credentials belong in the authentication
setting, never URL parameters. Returned bytes are size-bounded and checked for an
allowed PNG/JPEG/WebP signature before storage.

Generation is advertised only when a model and API key are configured. Without
them, the read-only lookup tools still work. Retain the MCP client's normal
per-tool approval policy: `generate_image` is annotated as a network/write tool;
the lookup tools are read-only. Annotations are hints, not an authorization system.

## Generate, recover and reopen

| Tool | Behavior |
| --- | --- |
| `generate_image` | Accepts `requestId`, `prompt` and optional `size`/`quality`. Saves admission before contacting the provider and promptly returns a stable job ID. |
| `get_image_job` | Reads by `jobId` or the original `requestId`. Optional `waitMs` from 0 to 20000 waits for completion; never submits another generation. |
| `list_generated_images` | Reads a bounded page (default 10, maximum 20), ordered by job ID, with an optional cursor. Corrupt records are counted and skipped. |

Use a unique `requestId` for each intentional generation. Reuse exactly that ID
when a tool call is repeated, interrupted or loses its response. Reusing an ID with
different parameters is rejected. The server permits one active generation per
MCP process and uses exclusive filesystem admission to deduplicate the same request
across processes sharing the project and job store.

Accepted work continues after the submission tool returns. Poll `get_image_job`
using `waitMs: 20000` when waiting in an agent conversation. CloudCLI also refreshes
the typed tool card through an authenticated, read-only project/job API, so a saved
running transcript can reveal its image after a reload without another model call.
Transient status-read failures use bounded retries with backoff; these are read-only
requests and never retry generation. Authentication/not-found responses stop polling.

Successful results contain an opaque asset ID, SHA-256 digest and a relative path
such as `generated-images/<asset-id>.png`. The tool card reuses CloudCLI's existing
authenticated project-image component and file-opening controls. Other MCP clients
can include `![Generated image](generated-images/<asset-id>.png)` in a response.
Neither image bytes nor provider keys are embedded in the transcript.

Images stay under the selected project. Job records (including the original prompt)
stay in the private job store, partitioned by canonical project path. For custom
storage, set `CLOUDCLI_IMAGE_DATA_DIR` to the same persistent directory for both the
MCP process and web server. The MCP-only `--data-dir` override must likewise match
the web server's setting for live job refresh. File-only transcript previews remain
available when old job metadata cannot be found.

## Failure and restart behavior

- `running`: a bounded request is accepted/in progress.
- `succeeded`: the saved image matches its expected digest.
- `failed`: the provider rejected the request.
- `uncertain`: a timeout, connection failure, interrupted process or incomplete save
  prevents confirming the outcome. Another process may still finish the request.
- `missing_asset`: a previously saved image was deleted, changed or became inaccessible.

No paid provider request is automatically retried, including HTTP 429/5xx failures.
The same `requestId` returns its saved state. Do not silently use a new ID to work
around uncertainty: doing so is an intentional new generation and may be charged.
Read-only lookups and page reloads never generate images.

After a process restart, a file saved before the final metadata update is recovered
only when its digest matches the saved asset plan. Symlinked output/state directories
and symlinked image files are rejected. Only transient local filesystem operations
use bounded retries with backoff.

Use a durable local data directory and retain it across restarts. Deleting that
directory discards the idempotency history; generated project files alone cannot
reconstruct every accepted request. File data is synced before success, and directory
entries are synced where the platform supports directory fsync. No cleanup or retention
policy deletes images automatically.

## Development verification

The module tests cover real stdio negotiation/tool calls, prompt fidelity, API
request/response handling, process interruption, deduplication, cross-project lookup,
filesystem containment, metadata recovery and unchanged bytes. Provider calls use a
local synthetic HTTP endpoint. Chat tests cover the versioned result contract,
inline previews, authenticated-file loading, read-only polling and transcript reload.

Protocol/API references:

- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [Official TypeScript MCP server SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Images generation API](https://developers.openai.com/api/reference/resources/images/methods/generate)

Design discussion: [#1816](https://github.com/siteboon/claudecodeui/discussions/1816).
