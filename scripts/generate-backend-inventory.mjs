import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const serverRoot = path.join(projectRoot, 'server');
const clientRoot = path.join(projectRoot, 'src');
const docsRoot = path.join(projectRoot, 'docs', 'backend');

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'];
const routeDefinitionPattern = /\b(app|router)\.(get|post|put|delete|patch)\(\s*(['"`])(.+?)\3/g;
const defaultImportPattern =
  /^import\s+([A-Za-z0-9_$]+)(?:\s*,\s*\{[^}]+\})?\s+from\s+['"](.+?)['"];$/gm;
const incomingRealtimePattern = /data\.type === '([^']+)'/g;
const outgoingRealtimePattern = /type:\s*'([^']+)'/g;

fs.mkdirSync(docsRoot, { recursive: true });

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function walkFiles(dirPath, files = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function getLineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function splitArgs(argumentSource) {
  return argumentSource
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function sanitizeObjectKey(key) {
  return key
    .replace(/^[\s{]+|[\s}]+$/g, '')
    .replace(/=.*$/, '')
    .replace(/:.+$/, '')
    .replace(/\?/g, '')
    .trim();
}

function collectObjectKeys(block, accessor) {
  const keys = new Set();
  const directPattern = new RegExp(`req\\.${accessor}\\.([A-Za-z0-9_]+)`, 'g');
  const destructuringPattern = new RegExp(`\\{([^}]*)\\}\\s*=\\s*req\\.${accessor}`, 'gs');

  for (const match of block.matchAll(directPattern)) {
    keys.add(match[1]);
  }

  for (const match of block.matchAll(destructuringPattern)) {
    for (const rawKey of match[1].split(',')) {
      const key = sanitizeObjectKey(rawKey);
      if (key) {
        keys.add(key);
      }
    }
  }

  return [...keys].sort();
}

function normalizeJoinedPath(basePath, routePath) {
  const safeBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  if (!routePath || routePath === '/') {
    return safeBase || '/';
  }

  if (routePath === '*') {
    return routePath;
  }

  const safeRoute = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${safeBase}${safeRoute}` || '/';
}

function getStaticSearchTokens(routePath) {
  const cleaned = routePath.replace(/:[A-Za-z0-9_]+/g, '').replace(/\*/g, '');
  const segments = cleaned.split('/').filter(Boolean);
  const tokens = new Set();

  if (cleaned && cleaned !== '/') {
    tokens.add(cleaned.endsWith('/') ? cleaned : `${cleaned}`);
  }

  for (let index = segments.length; index >= 2; index -= 1) {
    tokens.add(`/${segments.slice(0, index).join('/')}/`);
  }

  if (segments.length > 0) {
    tokens.add(`/${segments.slice(0, 1).join('/')}/`);
  }

  return [...tokens].filter(Boolean);
}

function classifyTag(routePath) {
  if (routePath === '*' || routePath === '/health' || routePath.startsWith('/api/system')) {
    return 'System';
  }

  if (routePath.startsWith('/api/auth')) return 'Auth';
  if (routePath.startsWith('/api/user')) return 'User';
  if (routePath.startsWith('/api/settings')) return 'Settings';
  if (routePath.startsWith('/api/git')) return 'Git';
  if (routePath.startsWith('/api/taskmaster')) return 'TaskMaster';
  if (routePath.startsWith('/api/plugins')) return 'Plugins';
  if (routePath.startsWith('/api/agent')) return 'Agent';
  if (routePath.startsWith('/api/commands')) return 'Commands';
  if (routePath.startsWith('/api/mcp')) return 'MCP';
  if (routePath.startsWith('/api/cli')) return 'CLI Auth';
  if (
    routePath.startsWith('/api/cursor') ||
    routePath.startsWith('/api/codex') ||
    routePath.startsWith('/api/gemini')
  ) {
    return 'Providers';
  }

  if (routePath.startsWith('/api/search') || routePath.includes('/sessions')) {
    return 'Sessions';
  }

  if (routePath.includes('/files') || routePath.includes('/file') || routePath.includes('/upload')) {
    return 'Files';
  }

  if (routePath.startsWith('/api/projects') || routePath.startsWith('/api/create-folder')) {
    return 'Projects';
  }

  return 'Realtime';
}

function classifyPriority(tag, routePath) {
  if (
    tag === 'Agent' ||
    tag === 'TaskMaster' ||
    tag === 'Git' ||
    routePath.startsWith('/api/projects') ||
    routePath.startsWith('/api/search')
  ) {
    return 'high';
  }

  if (
    tag === 'Providers' ||
    tag === 'Commands' ||
    tag === 'MCP' ||
    tag === 'Plugins' ||
    tag === 'Settings' ||
    tag === 'Auth' ||
    tag === 'User'
  ) {
    return 'medium';
  }

  return 'low';
}

function describePurpose(method, routePath) {
  const verb = method.toUpperCase();

  if (routePath === '/health') {
    return 'Expose server health, timestamp, and install mode for diagnostics.';
  }

  if (routePath === '*') {
    return 'Serve the React application fallback for non-API routes.';
  }

  if (routePath.startsWith('/api/system/update')) {
    return 'Run the application update workflow on the host machine.';
  }

  if (routePath.startsWith('/api/auth/status')) return 'Report whether authentication is configured.';
  if (routePath.startsWith('/api/auth/register')) return 'Create the first local user account.';
  if (routePath.startsWith('/api/auth/login')) return 'Authenticate a local user and issue a token.';
  if (routePath.startsWith('/api/auth/user')) return 'Return the currently authenticated user.';
  if (routePath.startsWith('/api/auth/logout')) return 'Invalidate the current authenticated session.';

  if (routePath.startsWith('/api/user/git-config')) return 'Read or update stored git identity settings.';
  if (routePath.startsWith('/api/user/complete-onboarding')) return 'Mark onboarding as completed for the current user.';
  if (routePath.startsWith('/api/user/onboarding-status')) return 'Return onboarding completion status for the current user.';

  if (routePath.startsWith('/api/settings/api-keys')) return 'Manage local API keys used to access the backend.';
  if (routePath.startsWith('/api/settings/credentials')) return 'Manage stored provider and GitHub credentials.';

  if (routePath.startsWith('/api/projects/create-workspace')) {
    return 'Create or register a workspace and optionally clone a GitHub repository into it.';
  }

  if (routePath.startsWith('/api/projects/clone-progress')) {
    return 'Stream workspace cloning progress events to the frontend.';
  }

  if (routePath === '/api/projects') return 'List detected projects and workspaces.';
  if (routePath.startsWith('/api/projects/create')) return 'Manually add a project path to the workspace list.';
  if (routePath.startsWith('/api/projects/:projectName/sessions/:sessionId/token-usage')) {
    return 'Report token usage for a stored provider session.';
  }

  if (routePath.includes('/sessions/:sessionId/messages')) {
    return 'Return paginated messages for a stored session.';
  }

  if (routePath.includes('/sessions')) {
    return 'List or manage sessions associated with a project or provider.';
  }

  if (routePath.includes('/files') || routePath.includes('/file')) {
    return 'Read, write, create, rename, delete, or upload project files.';
  }

  if (routePath.startsWith('/api/search/conversations')) {
    return 'Search conversation history across stored projects and stream results.';
  }

  if (routePath.startsWith('/api/browse-filesystem')) {
    return 'Browse local directories so the UI can suggest workspace locations.';
  }

  if (routePath.startsWith('/api/create-folder')) {
    return 'Create a new directory on the local filesystem.';
  }

  if (routePath.startsWith('/api/transcribe')) {
    return 'Transcribe uploaded audio and optionally enhance the result for prompts or tasks.';
  }

  if (routePath.includes('/upload-images')) {
    return 'Upload images for chat use and return browser-safe data URLs.';
  }

  if (routePath.startsWith('/api/git/status')) return 'Read git status information for a project.';
  if (routePath.startsWith('/api/git/diff')) return 'Return git diff output for a project or file.';
  if (routePath.startsWith('/api/git/file-with-diff')) return 'Return file content together with diff context.';
  if (routePath.startsWith('/api/git/branches')) return 'List git branches for a project.';
  if (routePath.startsWith('/api/git/commits')) return 'List recent commits for a project.';
  if (routePath.startsWith('/api/git/commit-diff')) return 'Return diff details for a specific commit.';
  if (routePath.startsWith('/api/git/remote-status')) return 'Report remote sync status for a project repository.';
  if (routePath.startsWith('/api/git/generate-commit-message')) return 'Generate an AI-assisted commit message from the current diff.';

  if (routePath.startsWith('/api/taskmaster')) {
    return 'Manage TaskMaster detection, PRDs, tasks, templates, and automation for a project.';
  }

  if (routePath.startsWith('/api/commands')) {
    return 'List, load, or execute slash commands available to the chat experience.';
  }

  if (routePath.startsWith('/api/mcp-utils')) {
    return 'Return MCP helper information used by setup flows.';
  }

  if (routePath.startsWith('/api/mcp')) {
    return 'Manage Claude MCP CLI and configuration state.';
  }

  if (routePath.startsWith('/api/cursor')) {
    return 'Manage Cursor configuration, MCP settings, and stored sessions.';
  }

  if (routePath.startsWith('/api/codex')) {
    return 'Manage Codex configuration, MCP settings, and stored sessions.';
  }

  if (routePath.startsWith('/api/gemini')) {
    return 'Manage Gemini session history for the UI.';
  }

  if (routePath.startsWith('/api/cli')) {
    return 'Report local authentication status for provider CLIs.';
  }

  if (routePath.startsWith('/api/plugins')) {
    return 'List, install, update, serve, enable, or remove plugins.';
  }

  if (routePath.startsWith('/api/agent')) {
    return 'Accept external agent jobs that run a provider against a local or cloned project.';
  }

  return `${verb} ${routePath} for backend runtime support.`;
}

function describeSuccessShape(block, transport) {
  if (transport === 'sse' || block.includes('text/event-stream')) {
    return 'Server-sent events stream with progress/result/error events.';
  }

  if (block.includes('res.sendFile')) {
    return 'Static file or HTML response.';
  }

  if (block.includes('res.redirect')) {
    return 'HTTP redirect response.';
  }

  if (block.includes('res.json({ success: true')) {
    return 'JSON object with an explicit success flag and payload.';
  }

  if (block.includes('res.json({')) {
    return 'Structured JSON object response.';
  }

  if (block.includes('res.json(')) {
    return 'JSON payload returned directly from service logic.';
  }

  return 'Mixed response shape; inspect handler during refactor.';
}

function describeErrorShape(block, transport) {
  if (transport === 'sse' || block.includes('text/event-stream')) {
    return 'Streamed error event or JSON error fallback.';
  }

  if (block.includes("res.status(500).json({ error:")) {
    return 'JSON object with error message and optional details.';
  }

  if (block.includes("res.status(400).json({ error:")) {
    return 'JSON validation error response.';
  }

  if (block.includes('res.status(')) {
    return 'JSON error response with HTTP status code.';
  }

  return 'Handler-specific error behavior.';
}

function describeSideEffects(method, routePath) {
  const effects = [];

  if (method !== 'get') {
    effects.push('Mutates backend or external state.');
  }

  if (routePath.includes('/git')) effects.push('Touches git repositories or local git config.');
  if (routePath.includes('/projects') || routePath.includes('/file') || routePath.includes('/files')) {
    effects.push('Touches local workspace files or directories.');
  }
  if (routePath.includes('/agent')) effects.push('Invokes external AI providers and may modify project files.');
  if (routePath.includes('/taskmaster')) effects.push('Reads or writes TaskMaster project assets.');
  if (routePath.includes('/plugins')) effects.push('Installs, updates, or serves plugin assets/processes.');
  if (routePath.includes('/settings') || routePath.includes('/auth') || routePath.includes('/credentials')) {
    effects.push('Reads or writes local authentication or credential state.');
  }
  if (routePath.includes('/mcp')) effects.push('Reads or writes MCP CLI configuration.');
  if (routePath.includes('/transcribe')) effects.push('Processes uploaded files and external model responses.');

  return effects.length > 0 ? effects : ['Read-only backend query.'];
}

function collectFrontendConsumers(routePath, clientFiles) {
  const tokens = getStaticSearchTokens(routePath);
  const consumers = new Set();

  for (const file of clientFiles) {
    const content = readText(file);
    if (tokens.some(token => token && content.includes(token))) {
      consumers.add(toPosix(path.relative(projectRoot, file)));
    }
  }

  return [...consumers].sort();
}

function detectTransport(block) {
  if (block.includes('text/event-stream')) {
    return 'sse';
  }

  return 'http';
}

function parseMounts(runtimeContent) {
  const routeImports = new Map();

  for (const match of runtimeContent.matchAll(defaultImportPattern)) {
    if (match[2].includes('/routes/')) {
      routeImports.set(match[1], match[2]);
    }
  }

  const mounts = new Map();
  const mountPattern = /app\.use\(\s*(['"`])([^'"`]+)\1\s*,\s*([^)]+?)\);/g;

  for (const match of runtimeContent.matchAll(mountPattern)) {
    const basePath = match[2];
    const args = splitArgs(match[3]);
    const routeVariable = args.at(-1);
    if (!routeVariable || !routeImports.has(routeVariable)) {
      continue;
    }

    mounts.set(routeVariable, {
      basePath,
      routeImport: routeImports.get(routeVariable),
      authMode: args.includes('authenticateToken')
        ? 'bearer_token'
        : args.includes('validateExternalApiKey')
          ? 'api_key_or_platform'
          : 'public_or_optional_api_key',
    });
  }

  return mounts;
}

function parseRoutes(filePath, fullPathPrefix, authMode, clientFiles) {
  const content = readText(filePath);
  const matches = [...content.matchAll(routeDefinitionPattern)];
  const routes = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const nextMatch = matches[index + 1];
    const routeMethod = match[2].toUpperCase();
    const routePath = match[4];
    const startIndex = match.index ?? 0;
    const endIndex = nextMatch?.index ?? content.length;
    const block = content.slice(startIndex, endIndex);
    const declarationEnd = block.indexOf('=>');
    const declarationSnippet = declarationEnd === -1 ? block : block.slice(0, declarationEnd);
    const fullPath = fullPathPrefix
      ? normalizeJoinedPath(fullPathPrefix, routePath)
      : routePath;
    const transport = detectTransport(block);
    const tag = classifyTag(fullPath);
    const pathParams = [...fullPath.matchAll(/:([A-Za-z0-9_]+)/g)].map(token => token[1]);
    const queryParams = collectObjectKeys(block, 'query');
    const bodyHints = collectObjectKeys(block, 'body');
    const localAuthMode =
      fullPath === '/health' ||
      fullPath === '/api/auth/status' ||
      fullPath === '/api/auth/register' ||
      fullPath === '/api/auth/login' ||
      fullPath === '*'
        ? 'public'
        : declarationSnippet.includes('authenticateToken')
          ? 'bearer_token'
          : declarationSnippet.includes('validateExternalApiKey')
            ? 'api_key_or_platform'
            : authMode;

    routes.push({
      transport,
      method: routeMethod,
      path: fullPath,
      tag,
      authMode: localAuthMode,
      sourceFile: toPosix(path.relative(projectRoot, filePath)),
      sourceLine: getLineNumber(content, startIndex),
      purpose: describePurpose(routeMethod, fullPath),
      consumerFiles: collectFrontendConsumers(fullPath, clientFiles),
      inputs: {
        pathParams,
        queryParams,
        bodyHints,
      },
      successShape: describeSuccessShape(block, transport),
      errorShape: describeErrorShape(block, transport),
      sideEffects: describeSideEffects(routeMethod.toLowerCase(), fullPath),
      priority: classifyPriority(tag, fullPath),
    });
  }

  return routes;
}

function parseRealtimeContracts(runtimeFile) {
  const content = readText(runtimeFile);
  const incoming = new Set();
  const outgoing = new Set();

  for (const match of content.matchAll(incomingRealtimePattern)) {
    incoming.add(match[1]);
  }

  const websocketSectionIndex = content.indexOf("wss.on('connection'");
  const websocketSection = websocketSectionIndex === -1 ? content : content.slice(websocketSectionIndex);

  for (const match of websocketSection.matchAll(outgoingRealtimePattern)) {
    outgoing.add(match[1]);
  }

  return {
    incomingMessageTypes: [...incoming].sort(),
    outgoingMessageTypes: [...outgoing].sort(),
  };
}

function escapeCsv(value) {
  const stringValue = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  const escaped = stringValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

function writeCsv(filePath, records) {
  const header = [
    'transport',
    'method',
    'path',
    'tag',
    'authMode',
    'sourceFile',
    'sourceLine',
    'purpose',
    'consumerFiles',
    'pathParams',
    'queryParams',
    'bodyHints',
    'successShape',
    'errorShape',
    'sideEffects',
    'priority',
  ];

  const rows = [
    header.join(','),
    ...records.map(record => [
      record.transport,
      record.method,
      record.path,
      record.tag,
      record.authMode,
      record.sourceFile,
      record.sourceLine,
      record.purpose,
      record.consumerFiles,
      record.inputs.pathParams,
      record.inputs.queryParams,
      record.inputs.bodyHints,
      record.successShape,
      record.errorShape,
      record.sideEffects,
      record.priority,
    ].map(escapeCsv).join(',')),
  ];

  fs.writeFileSync(filePath, `${rows.join('\n')}\n`);
}

function writeMarkdown(filePath, summary, records, realtimeContracts) {
  const grouped = new Map();

  for (const record of records) {
    if (!grouped.has(record.tag)) {
      grouped.set(record.tag, []);
    }

    grouped.get(record.tag).push(record);
  }

  const lines = [
    '# Backend Inventory',
    '',
    `Generated on ${summary.generatedAt}.`,
    '',
    '## Summary',
    '',
    `- HTTP routes: ${summary.httpRoutes}`,
    `- SSE routes: ${summary.sseRoutes}`,
    `- Modular routes: ${summary.modularRoutes}`,
    `- Inline routes: ${summary.inlineRoutes}`,
    `- Route files scanned: ${summary.routeFilesScanned}`,
    '',
    '## Realtime Contracts',
    '',
    `- Incoming websocket message types (${realtimeContracts.incomingMessageTypes.length}): ${realtimeContracts.incomingMessageTypes.join(', ')}`,
    `- Outgoing websocket message types (${realtimeContracts.outgoingMessageTypes.length}): ${realtimeContracts.outgoingMessageTypes.join(', ')}`,
    '',
  ];

  for (const [tag, tagRecords] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`## ${tag}`);
    lines.push('');
    lines.push('| Method | Path | Auth | Purpose | Consumers | Source |');
    lines.push('| --- | --- | --- | --- | --- | --- |');

    for (const record of tagRecords.sort((left, right) => left.path.localeCompare(right.path))) {
      lines.push(
        `| ${record.method} | \`${record.path}\` | ${record.authMode} | ${record.purpose} | ${record.consumerFiles.join('<br>') || '-'} | ${record.sourceFile}:${record.sourceLine} |`
      );
    }

    lines.push('');
  }

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const clientFiles = walkFiles(clientRoot).filter(filePath => /\.(js|jsx|ts|tsx)$/.test(filePath));
const legacyRuntimePath = path.join(serverRoot, 'legacy-runtime.js');
const runtimeContent = readText(legacyRuntimePath);
const mounts = parseMounts(runtimeContent);
const records = [];

records.push(...parseRoutes(legacyRuntimePath, '', 'mixed_or_inline', clientFiles));

for (const [routeVariable, mount] of mounts.entries()) {
  const relativeImport = mount.routeImport.replace('./', '');
  const routeFilePath = path.join(serverRoot, relativeImport);
  records.push(...parseRoutes(routeFilePath, mount.basePath, mount.authMode, clientFiles));
}

const realtimeContracts = parseRealtimeContracts(legacyRuntimePath);
const summary = {
  generatedAt: new Date().toISOString(),
  httpRoutes: records.filter(record => record.transport === 'http').length,
  sseRoutes: records.filter(record => record.transport === 'sse').length,
  modularRoutes: records.filter(record => record.sourceFile.includes('/routes/')).length,
  inlineRoutes: records.filter(record => record.sourceFile === 'server/legacy-runtime.js').length,
  routeFilesScanned: new Set(records.map(record => record.sourceFile)).size,
};

fs.writeFileSync(
  path.join(docsRoot, 'endpoint-inventory.json'),
  JSON.stringify({ summary, realtimeContracts, records }, null, 2)
);

writeCsv(path.join(docsRoot, 'endpoint-inventory.csv'), records);
writeMarkdown(path.join(docsRoot, 'endpoint-inventory.md'), summary, records, realtimeContracts);

console.log('[inventory] Generated docs/backend/endpoint-inventory.{json,csv,md}');
console.log(
  `[inventory] HTTP=${summary.httpRoutes} SSE=${summary.sseRoutes} Modular=${summary.modularRoutes} Inline=${summary.inlineRoutes}`
);
