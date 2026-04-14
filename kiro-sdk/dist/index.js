/**
 * kiro-sdk — public API
 *
 * Usage:
 *   import { query } from 'kiro-sdk';
 *   for await (const msg of query({ prompt: 'Hello', options: { cwd: '.' } })) { ... }
 */
import { AcpTransport } from './acp-transport.js';
import { SessionRouter } from './session.js';
// Singleton transport — one kiro-cli acp process for all queries
let transport = null;
const router = new SessionRouter();
function getTransport() {
    if (!transport) {
        transport = new AcpTransport();
        transport.setNotificationHandler((method, params) => {
            if (method !== 'session/update')
                return;
            const sessionId = params.sessionId;
            const update = (params.update || params);
            const type = (update.sessionUpdate || update.type || update.kind);
            if (!sessionId || !router.has(sessionId))
                return;
            if (type === 'agent_message_chunk') {
                const content = update.content;
                const text = (content?.text || '');
                if (text) {
                    router.push(sessionId, { type: 'assistant', content: text, session_id: sessionId });
                }
            }
            else if (type === 'tool_call') {
                router.push(sessionId, {
                    type: 'tool_use',
                    name: (update.name || update.toolName || 'unknown'),
                    input: (update.parameters || update.input || {}),
                    id: (update.id || update.toolUseId || ''),
                    status: (update.status || 'running'),
                    session_id: sessionId,
                });
            }
            else if (type === 'tool_call_update') {
                const content = update.content;
                router.push(sessionId, {
                    type: 'tool_progress',
                    content: (content?.text || update.text || ''),
                    tool_id: (update.id || update.toolUseId || ''),
                    session_id: sessionId,
                });
            }
            else if (type === 'turn_end') {
                router.finish(sessionId);
            }
        });
    }
    return transport;
}
/**
 * Send a prompt to Kiro and stream back typed messages.
 *
 * Mirrors the `query()` function from @anthropic-ai/claude-agent-sdk.
 * Returns an AsyncGenerator<KiroMessage> with additional control methods.
 */
export function query(params) {
    const { prompt, options = {} } = params;
    let acpSessionId = null;
    const generator = (async function* () {
        const t = getTransport();
        await t.connect(buildAcpArgs(options));
        if (options.resume) {
            // Reuse existing ACP session — just send another prompt
            acpSessionId = options.resume;
        }
        else {
            const result = await t.sendRpc('session/new', {
                cwd: options.cwd || process.cwd(),
                mcpServers: options.mcpServers || [],
            });
            acpSessionId = result?.sessionId;
        }
        if (!acpSessionId)
            throw new Error('Failed to create ACP session');
        router.register(acpSessionId);
        try {
            // Note: set_model is intentionally skipped — it crashes kiro-cli with
            // certain model ID formats. Kiro uses 'auto' by default which works well.
            // Fire the prompt RPC but DON'T await it before yielding.
            // kiro-cli streams notifications (agent_message_chunk, tool_call, etc.)
            // BEFORE the RPC response arrives. If we await here, the generator blocks
            // and the UI shows "Thinking..." until the entire turn completes.
            const promptDone = t.sendRpc('session/prompt', {
                sessionId: acpSessionId,
                prompt: [{ type: 'text', text: prompt }],
            }).then((result) => {
                const r = result;
                if (r?.stopReason) {
                    router.finish(acpSessionId);
                }
            }).catch((err) => {
                router.finish(acpSessionId, true);
            });
            // Yield messages as they stream in via notifications
            yield* router.iterate(acpSessionId);
            // Ensure the RPC has settled before we exit
            await promptDone;
        }
        finally {
            router.unregister(acpSessionId);
        }
    })();
    // Attach control methods to match Claude SDK's Query interface
    const query = generator;
    Object.defineProperty(query, 'sessionId', {
        get: () => acpSessionId,
    });
    query.interrupt = async () => {
        if (acpSessionId) {
            const t = getTransport();
            await t.sendRpc('session/cancel', { sessionId: acpSessionId }).catch(() => { });
            router.finish(acpSessionId, false);
        }
    };
    query.setModel = async (model) => {
        const t = getTransport();
        await t.sendRpc('session/set_model', { model });
    };
    return query;
}
/** Disconnect the ACP process. Call on shutdown. */
export function disconnect() {
    transport?.disconnect();
    transport = null;
}
function buildAcpArgs(options) {
    const args = [];
    if (options.trustAllTools)
        args.push('--trust-all-tools');
    if (options.trustTools?.length)
        args.push('--trust-tools', options.trustTools.join(','));
    if (options.agent)
        args.push('--agent', options.agent);
    return args;
}
