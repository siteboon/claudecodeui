/**
 * A stand-in for `opencode serve`, used by the OpenCode runtime tests in place
 * of the real binary. The SDK's `createOpencodeServer` spawns it exactly like
 * OpenCode (`opencode serve --hostname=… --port=…`) and waits for the same
 * "listening" line; the runtime then talks to it through the SDK client.
 *
 * It implements just the API the runtime uses, with OpenCode's semantics where
 * they matter: Basic auth from OPENCODE_SERVER_PASSWORD, an SSE event stream
 * that opens with `server.connected`, `prompt_async` answering at once while
 * the turn runs, permission and question requests that wait for their reply,
 * a rejected permission or dismissed question ending the turn, and an abort
 * that reports MessageAbortedError.
 *
 * The turn is scripted through FAKE_OPENCODE_SCENARIO (JSON, see `Scenario`);
 * every request is appended to FAKE_OPENCODE_LOG as one JSON line.
 */
import fs from 'node:fs';
import http from 'node:http';

type PermissionRule = { permission: string; pattern: string; action: string };

type Step =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
    type: 'permission';
    id: string;
    permission: string;
    patterns: string[];
    always: string[];
    metadata?: Record<string, unknown>;
  }
  | { type: 'question'; id: string; questions: unknown[] }
  /** Several requests asked at once; a reject of one rejects the rest, as OpenCode does. */
  | { type: 'parallel-permissions'; requests: Array<{ id: string; permission: string; patterns: string[]; always: string[] }> }
  | { type: 'error'; name: string; message: string }
  | { type: 'crash' }
  | { type: 'hang' };

type Scenario = {
  /** Id given to a session created through POST /session. */
  newSessionId?: string;
  /** Sessions GET /session/:id knows; any other id answers 404. */
  sessions?: Record<string, { permission?: PermissionRule[] }>;
  agents?: Array<{ name: string; permission: PermissionRule[] }>;
  defaultAgent?: string;
  /** Answered with a status instead of 204, as OpenCode does for a bad prompt. */
  promptStatus?: number;
  /** Version /global/health reports; null makes the route missing, as before OpenCode 1.0.224. */
  version?: string | null;
  /** How long POST /session/:id/abort takes to answer. */
  abortDelayMs?: number;
  /**
   * Requests OpenCode has already settled by the time the chat's reply lands
   * (a cascade raced it): the reply gets the 404 OpenCode sends, and the
   * request is settled as rejected.
   */
  replyNotFound?: string[];
  /** A question OpenCode raises while the abort is being handled. */
  askOnAbort?: { id: string; questions: unknown[] };
  steps: Step[];
};

const args = process.argv.slice(2);
const readFlag = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const scenario = JSON.parse(process.env.FAKE_OPENCODE_SCENARIO || '{"steps":[]}') as Scenario;
const logPath = process.env.FAKE_OPENCODE_LOG;
const password = process.env.OPENCODE_SERVER_PASSWORD;
const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';

const log = (entry: Record<string, unknown>) => {
  if (logPath) {
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  }
};

if (args[0] !== 'serve') {
  console.error(`fake opencode: unsupported command ${args.join(' ')}`);
  process.exit(2);
}

const streams = new Set<http.ServerResponse>();
const sessions = new Map(Object.entries(scenario.sessions ?? {}));
const waiting = new Map<string, (reply: { kind: 'permission' | 'question'; value: unknown }) => void>();
let eventCounter = 0;
let partCounter = 0;
let turnAborted: (() => void) | null = null;

const emit = (type: string, properties: Record<string, unknown>) => {
  const data = JSON.stringify({ id: `evt_${++eventCounter}`, type, properties });
  for (const stream of streams) {
    stream.write(`data: ${data}\n\n`);
  }
};

const emitPart = (sessionID: string, part: Record<string, unknown>) => {
  emit('message.part.updated', {
    sessionID,
    part: { id: `prt_${++partCounter}`, sessionID, messageID: 'msg_assistant', ...part },
    time: Date.now(),
  });
};

const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage) => new Promise<unknown>((resolve) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : undefined);
    } catch {
      resolve(raw);
    }
  });
});

/** Runs the scripted turn the way OpenCode's session loop reports it. */
async function runTurn(sessionID: string): Promise<void> {
  const aborted = new Promise<'aborted'>((resolve) => {
    turnAborted = () => resolve('aborted');
  });
  const now = Date.now();
  emit('message.updated', { sessionID, info: { id: 'msg_user', sessionID, role: 'user' } });
  emitPart(sessionID, { messageID: 'msg_user', type: 'text', text: 'the prompt' });

  for (const step of scenario.steps) {
    if (step.type === 'error') {
      // A prompt that fails before its loop starts never reports busy/idle.
      emit('session.error', { sessionID, error: { name: step.name, data: { message: step.message } } });
      return;
    }
  }

  emit('session.status', { sessionID, status: { type: 'busy' } });
  emit('message.updated', { sessionID, info: { id: 'msg_assistant', sessionID, role: 'assistant' } });

  for (const step of scenario.steps) {
    if (step.type === 'crash') {
      process.exit(1);
    }

    if (step.type === 'hang') {
      await aborted;
      emit('session.error', { sessionID, error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } });
      emit('session.status', { sessionID, status: { type: 'idle' } });
      return;
    }

    if (step.type === 'text' || step.type === 'reasoning') {
      emitPart(sessionID, { type: step.type, text: step.text, time: { start: now, end: Date.now() } });
      continue;
    }

    if (step.type === 'permission') {
      const answer = new Promise<{ kind: string; value: unknown }>((resolve) => waiting.set(step.id, resolve));
      emit('permission.asked', {
        id: step.id,
        sessionID,
        permission: step.permission,
        patterns: step.patterns,
        always: step.always,
        metadata: step.metadata ?? {},
      });
      const outcome = await Promise.race([answer, aborted]);
      if (outcome === 'aborted') {
        emit('session.error', { sessionID, error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } });
        emit('session.status', { sessionID, status: { type: 'idle' } });
        return;
      }
      const rejected = outcome.value === 'reject';
      emitPart(sessionID, {
        type: 'tool',
        callID: `call_${step.id}`,
        tool: step.permission,
        state: rejected
          ? { status: 'error', input: step.metadata ?? {}, error: 'The user rejected permission to use this specific tool call.', time: { start: now, end: Date.now() } }
          : { status: 'completed', input: step.metadata ?? {}, output: `ran ${step.patterns.join(' ')}`, title: step.permission, metadata: {}, time: { start: now, end: Date.now() } },
      });
      if (rejected) {
        break;
      }
      continue;
    }

    if (step.type === 'parallel-permissions') {
      const answers = step.requests.map((request) => {
        const answer = new Promise<{ kind: string; value: unknown }>((resolve) => waiting.set(request.id, resolve));
        emit('permission.asked', { ...request, sessionID, metadata: {} });
        return answer;
      });
      const first = await Promise.race([Promise.race(answers), aborted]);
      if (first === 'aborted') {
        emit('session.status', { sessionID, status: { type: 'idle' } });
        return;
      }
      if (first.value === 'reject') {
        // OpenCode rejects every other pending request of the session too.
        for (const request of step.requests) {
          const resolve = waiting.get(request.id);
          if (resolve) {
            waiting.delete(request.id);
            emit('permission.replied', { sessionID, requestID: request.id, reply: 'reject' });
            resolve({ kind: 'permission', value: 'reject' });
          }
        }
        break;
      }
      await Promise.all(answers);
      continue;
    }

    if (step.type === 'question') {
      const answer = new Promise<{ kind: string; value: unknown }>((resolve) => waiting.set(step.id, resolve));
      emit('question.asked', { id: step.id, sessionID, questions: step.questions });
      const outcome = await Promise.race([answer, aborted]);
      if (outcome === 'aborted') {
        emit('session.status', { sessionID, status: { type: 'idle' } });
        return;
      }
      const dismissed = outcome.value === null;
      emitPart(sessionID, {
        type: 'tool',
        callID: `call_${step.id}`,
        tool: 'question',
        state: dismissed
          ? { status: 'error', input: { questions: step.questions }, error: 'The user dismissed this question', time: { start: now, end: Date.now() } }
          : { status: 'completed', input: { questions: step.questions }, output: 'User has answered your questions', title: 'Asked', metadata: { answers: outcome.value }, time: { start: now, end: Date.now() } },
      });
      if (dismissed) {
        break;
      }
    }
  }

  emitPart(sessionID, { type: 'step-finish', reason: 'stop', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } });
  emit('session.status', { sessionID, status: { type: 'idle' } });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://fake');
  const body = req.method === 'GET' ? undefined : await readBody(req);
  const authorization = req.headers.authorization ?? null;
  // GET requests carry the directory as a query parameter, the others as an
  // encoded header; OpenCode decodes both.
  const directoryHeader = req.headers['x-opencode-directory'];
  log({
    method: req.method,
    path: url.pathname,
    directory: url.searchParams.get('directory')
      ?? (typeof directoryHeader === 'string' ? decodeURIComponent(directoryHeader) : null),
    authorization,
    body,
  });

  if (password && authorization !== `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="Secure Area"' });
    res.end();
    return;
  }

  const path = url.pathname;
  let match: RegExpExecArray | null;

  if (req.method === 'GET' && path === '/event') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    streams.add(res);
    res.write(`data: ${JSON.stringify({ id: 'evt_0', type: 'server.connected', properties: {} })}\n\n`);
    req.on('close', () => streams.delete(res));
    return;
  }

  if (req.method === 'POST' && path === '/session') {
    const id = scenario.newSessionId ?? 'ses_fake_new';
    sessions.set(id, { permission: (body as { permission?: PermissionRule[] } | undefined)?.permission });
    sendJson(res, 200, { id, title: 'New session', directory: url.searchParams.get('directory') });
    return;
  }

  if ((match = /^\/session\/([^/]+)$/.exec(path))) {
    const session = sessions.get(match[1]);
    if (!session) {
      sendJson(res, 404, { name: 'NotFoundError', data: { message: `Session not found: ${match[1]}` } });
      return;
    }
    if (req.method === 'PATCH') {
      const added = (body as { permission?: PermissionRule[] } | undefined)?.permission ?? [];
      session.permission = [...(session.permission ?? []), ...added];
    }
    sendJson(res, 200, { id: match[1], title: 'Session', permission: session.permission });
    return;
  }

  if (req.method === 'GET' && path === '/global/health') {
    if (scenario.version === null) {
      sendJson(res, 404, { name: 'NotFoundError', data: { message: 'No route' } });
      return;
    }
    sendJson(res, 200, { healthy: true, version: scenario.version ?? '1.19.5' });
    return;
  }

  if (req.method === 'GET' && path === '/agent') {
    sendJson(res, 200, (scenario.agents ?? [
      { name: 'build', permission: [{ permission: 'question', pattern: '*', action: 'allow' }] },
      { name: 'plan', permission: [{ permission: 'question', pattern: '*', action: 'allow' }] },
    ]).map((agent) => ({ ...agent, mode: 'primary', options: {} })));
    return;
  }

  if (req.method === 'GET' && path === '/config') {
    sendJson(res, 200, scenario.defaultAgent ? { default_agent: scenario.defaultAgent } : {});
    return;
  }

  if (req.method === 'POST' && (match = /^\/session\/([^/]+)\/prompt_async$/.exec(path))) {
    if (scenario.promptStatus) {
      sendJson(res, scenario.promptStatus, { name: 'BadRequest', data: { message: 'The prompt was refused' } });
      return;
    }
    res.writeHead(204);
    res.end();
    void runTurn(match[1]);
    return;
  }

  if (req.method === 'POST' && (match = /^\/session\/([^/]+)\/abort$/.exec(path))) {
    if (scenario.askOnAbort) {
      emit('question.asked', { ...scenario.askOnAbort, sessionID: match[1] });
    }
    if (scenario.abortDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, scenario.abortDelayMs));
    }
    turnAborted?.();
    sendJson(res, 200, true);
    return;
  }

  if (req.method === 'POST' && (match = /^\/(permission|question)\/([^/]+)\/(reply|reject)$/.exec(path))) {
    const [, kind, requestID, action] = match;
    const resolve = waiting.get(requestID);
    // The body OpenCode answers an unknown request id with (checked on 1.18.25).
    const notFound = kind === 'permission'
      ? { _tag: 'PermissionNotFoundError', requestID, message: `Permission request not found: ${requestID}` }
      : { _tag: 'QuestionNotFoundError', requestID, message: `Question request not found: ${requestID}` };
    if (!resolve) {
      sendJson(res, 404, notFound);
      return;
    }
    if (scenario.replyNotFound?.includes(requestID)) {
      waiting.delete(requestID);
      emit('permission.replied', { sessionID: 'any', requestID, reply: 'reject' });
      resolve({ kind: kind as 'permission' | 'question', value: 'reject' });
      sendJson(res, 404, notFound);
      return;
    }
    waiting.delete(requestID);
    const payload = body as { reply?: string; answers?: unknown } | undefined;
    const value = kind === 'permission' ? payload?.reply : action === 'reject' ? null : payload?.answers;
    if (kind === 'permission') {
      emit('permission.replied', { sessionID: 'any', requestID, reply: value });
    } else {
      emit(action === 'reject' ? 'question.rejected' : 'question.replied', { sessionID: 'any', requestID, answers: value });
    }
    resolve({ kind: kind as 'permission' | 'question', value });
    sendJson(res, 200, true);
    return;
  }

  sendJson(res, 404, { name: 'NotFoundError', data: { message: `No route for ${req.method} ${path}` } });
});

server.listen(Number(readFlag('port') ?? 0), readFlag('hostname') ?? '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  log({ started: true, pid: process.pid, port, args, passwordSet: Boolean(password) });
  console.log(`opencode server listening on http://${readFlag('hostname') ?? '127.0.0.1'}:${port}`);
});
