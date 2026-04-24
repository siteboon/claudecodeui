#!/usr/bin/env node
/**
 * Unit tests for server/claude-stream.js public helpers (ownership / liveness /
 * in-flight / writer reconnect). Uses the `__test__` internals export to seed
 * `activeStreamSessions` with fake session objects, so no real `claude` CLI
 * process is spawned.
 *
 * Run: npx tsx scripts/test-claude-stream.mjs
 */

import {
    isClaudeStreamSessionActive,
    isClaudeStreamSessionProcessing,
    getClaudeStreamSessionStatus,
    getActiveClaudeStreamSessions,
    reconnectStreamSessionWriter,
    __test__,
} from '../server/claude-stream.js';

const { activeStreamSessions } = __test__;

let failed = 0;
const pass = (name) => console.log(`  ok  ${name}`);
const fail = (name, detail) => {
    failed++;
    console.error(`  FAIL  ${name}\n        ${detail}`);
};
function assertEqual(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) fail(name, `expected ${e}, got ${a}`);
    else pass(name);
}

/** Fake session factory. `alive` drives process.exitCode; `inFlight` flag and
 *  owner userId are stored on the writer to match production layout. */
function makeFakeSession({ sessionId, userId, alive = true, inFlight = false, status = 'idle' }) {
    const writer = {
        userId,
        updateWebSocket: () => { writer.swapped = (writer.swapped || 0) + 1; },
    };
    return {
        sessionId,
        inFlight,
        status,
        writer,
        process: {
            exitCode: alive ? null : 0,
            signalCode: null,
        },
    };
}

function reset() {
    activeStreamSessions.clear();
}

/* 1. isClaudeStreamSessionActive — alive + owned */
{
    reset();
    const s = makeFakeSession({ sessionId: 'a', userId: 1, alive: true });
    activeStreamSessions.set('a', s);
    assertEqual('1. active when alive & owner match', isClaudeStreamSessionActive('a', 1), true);
    assertEqual('1. not active for wrong owner', isClaudeStreamSessionActive('a', 2), false);
    assertEqual('1. not active for unknown session', isClaudeStreamSessionActive('missing', 1), false);
}

/* 2. isClaudeStreamSessionActive — dead process pruned */
{
    reset();
    const s = makeFakeSession({ sessionId: 'b', userId: 1, alive: false });
    activeStreamSessions.set('b', s);
    assertEqual('2. dead session reports not active', isClaudeStreamSessionActive('b', 1), false);
    assertEqual('2. dead session pruned from map', activeStreamSessions.has('b'), false);
}

/* 3. isClaudeStreamSessionProcessing — inFlight flag */
{
    reset();
    const idle = makeFakeSession({ sessionId: 'idle', userId: 1, inFlight: false });
    const busy = makeFakeSession({ sessionId: 'busy', userId: 1, inFlight: true });
    activeStreamSessions.set('idle', idle);
    activeStreamSessions.set('busy', busy);
    assertEqual('3. idle session reports not processing', isClaudeStreamSessionProcessing('idle', 1), false);
    assertEqual('3. busy session reports processing', isClaudeStreamSessionProcessing('busy', 1), true);
    assertEqual('3. processing requires ownership', isClaudeStreamSessionProcessing('busy', 2), false);
}

/* 4. getActiveClaudeStreamSessions — filters by owner, skips `pending:*` keys */
{
    reset();
    activeStreamSessions.set('s1', makeFakeSession({ sessionId: 's1', userId: 1 }));
    activeStreamSessions.set('s2', makeFakeSession({ sessionId: 's2', userId: 2 }));
    activeStreamSessions.set('pending:xyz', makeFakeSession({ sessionId: null, userId: 1 }));
    const user1 = getActiveClaudeStreamSessions(1).sort();
    const user2 = getActiveClaudeStreamSessions(2);
    assertEqual('4. user1 sees only own session, pending hidden', user1, ['s1']);
    assertEqual('4. user2 sees only own session', user2, ['s2']);
}

/* 5. getActiveClaudeStreamSessions — prunes dead sessions during iteration */
{
    reset();
    const live = makeFakeSession({ sessionId: 'live', userId: 1, alive: true });
    const dead = makeFakeSession({ sessionId: 'dead', userId: 1, alive: false });
    activeStreamSessions.set('live', live);
    activeStreamSessions.set('dead', dead);
    const list = getActiveClaudeStreamSessions(1);
    assertEqual('5. list omits dead session', list, ['live']);
    assertEqual('5. dead session evicted from map', activeStreamSessions.has('dead'), false);
    assertEqual('5. live session still present', activeStreamSessions.has('live'), true);
}

/* 6. reconnectStreamSessionWriter — swaps when owner matches, refuses otherwise */
{
    reset();
    const s = makeFakeSession({ sessionId: 'c', userId: 1 });
    activeStreamSessions.set('c', s);

    const newWs = { readyState: 1 };
    assertEqual('6. reconnect succeeds for owner', reconnectStreamSessionWriter('c', newWs, 1), true);
    assertEqual('6. reconnect invoked writer.updateWebSocket', s.writer.swapped, 1);

    assertEqual('6. reconnect rejected for non-owner', reconnectStreamSessionWriter('c', newWs, 99), false);
    assertEqual('6. non-owner did not trigger extra swap', s.writer.swapped, 1);

    assertEqual('6. reconnect fails for unknown session', reconnectStreamSessionWriter('missing', newWs, 1), false);
}

/* 7a. getClaudeStreamSessionStatus reports running/idle/aborted; null when unknown */
{
    reset();
    const running = makeFakeSession({ sessionId: 'run', userId: 1, status: 'running' });
    const idle = makeFakeSession({ sessionId: 'idle', userId: 1, status: 'idle' });
    const aborted = makeFakeSession({ sessionId: 'ab', userId: 1, status: 'aborted' });
    const missingStatus = makeFakeSession({ sessionId: 'nostat', userId: 1 });
    delete missingStatus.status;
    activeStreamSessions.set('run', running);
    activeStreamSessions.set('idle', idle);
    activeStreamSessions.set('ab', aborted);
    activeStreamSessions.set('nostat', missingStatus);
    assertEqual('7a. running status exposed', getClaudeStreamSessionStatus('run', 1), 'running');
    assertEqual('7a. idle status exposed', getClaudeStreamSessionStatus('idle', 1), 'idle');
    assertEqual('7a. aborted status exposed', getClaudeStreamSessionStatus('ab', 1), 'aborted');
    assertEqual('7a. missing status defaults to idle', getClaudeStreamSessionStatus('nostat', 1), 'idle');
    assertEqual('7a. null for unknown session', getClaudeStreamSessionStatus('missing', 1), null);
    assertEqual('7a. null for non-owner', getClaudeStreamSessionStatus('run', 99), null);
}

/* 7b. accumulateTokenBudget folds per-prompt usage into session totals */
{
    const session = { cumulativeTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } };
    const first = __test__.accumulateTokenBudget(session, {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
    });
    assertEqual('7b. first fold returns used+total', { used: first.used, total: first.total }, {
        used: 180,
        total: 160000,
    });
    assertEqual('7b. session cumulative updated', session.cumulativeTokens, {
        input: 100, output: 50, cacheRead: 20, cacheCreation: 10,
    });
    const second = __test__.accumulateTokenBudget(session, { input_tokens: 10, output_tokens: 5 });
    assertEqual('7b. second fold accumulates', second.used, 195);
    assertEqual('7b. null usage → null', __test__.accumulateTokenBudget(session, null), null);
    assertEqual('7b. all-zero usage → null', __test__.accumulateTokenBudget(session, { input_tokens: 0 }), null);
    assertEqual('7b. non-numeric usage fields ignored', __test__.accumulateTokenBudget(session, { input_tokens: 'abc', output_tokens: 7 }).used, 202);
}

/* 7. sessionBelongsTo internal — null userId is treated as internal caller */
{
    const s = makeFakeSession({ sessionId: 'x', userId: 7 });
    assertEqual('7. null userId bypasses ownership', __test__.sessionBelongsTo(s, null), true);
    assertEqual('7. undefined userId bypasses ownership', __test__.sessionBelongsTo(s, undefined), true);
    assertEqual('7. matching userId passes', __test__.sessionBelongsTo(s, 7), true);
    assertEqual('7. mismatching userId fails', __test__.sessionBelongsTo(s, 8), false);
}

/* 8. handleEvent: rate_limit_event → status message */
{
    const sent = [];
    const session = {
        sessionId: 's1',
        inFlight: false,
        queue: [],
        status: 'idle',
        writer: { userId: 1, send: (m) => sent.push(m) },
        process: { exitCode: null, signalCode: null, pid: 1 },
        cumulativeTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    };
    __test__.handleEvent(session, {
        type: 'rate_limit_event',
        rate_limit_info: { utilization: 0.82, rateLimitType: 'input_tokens' },
    });
    assertEqual('8. rate_limit emits status', sent[0]?.kind, 'status');
    assertEqual('8. rate_limit text flag', sent[0]?.text, 'rate_limit');
    assertEqual('8. rate_limit content has utilization', (sent[0]?.content || '').includes('82%'), true);
}

/* 9. handleEvent: hook lifecycle (started / progress / response) forwards as status */
{
    const sent = [];
    const session = {
        sessionId: 's2',
        inFlight: false,
        queue: [],
        status: 'idle',
        writer: { userId: 1, send: (m) => sent.push(m) },
        process: { exitCode: null, signalCode: null, pid: 1 },
        cumulativeTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    };
    __test__.handleEvent(session, {
        type: 'system', subtype: 'hook_started',
        hook_id: 'h1', hook_name: 'PreToolUse', hook_event: 'PreToolUse',
    });
    __test__.handleEvent(session, {
        type: 'system', subtype: 'hook_progress',
        hook_id: 'h1', hook_name: 'PreToolUse', hook_event: 'PreToolUse',
        stdout: 'step 1\n', stderr: '', output: '',
    });
    __test__.handleEvent(session, {
        type: 'system', subtype: 'hook_response',
        hook_id: 'h1', hook_name: 'PreToolUse', hook_event: 'PreToolUse',
        outcome: 'success', exit_code: 0, stdout: 'done\n', stderr: '', output: '',
    });
    assertEqual('9. hook_started surfaced', sent[0]?.text, 'hook_started');
    assertEqual('9. hook_started source', sent[0]?.source, 'PreToolUse');
    assertEqual('9. hook_started carries hookId', sent[0]?.hookId, 'h1');
    assertEqual('9. hook_progress surfaced', sent[1]?.text, 'hook_progress');
    assertEqual('9. hook_progress stdout forwarded', sent[1]?.stdout, 'step 1\n');
    assertEqual('9. hook_response surfaced', sent[2]?.text, 'hook_response');
    assertEqual('9. hook_response outcome', sent[2]?.outcome, 'success');
    assertEqual('9. hook_response exit_code', sent[2]?.exitCode, 0);
}

/* 9b. hook_response SessionStart-style systemMessage gets promoted */
{
    const sent = [];
    const session = {
        sessionId: 's2b',
        inFlight: false,
        queue: [],
        status: 'idle',
        writer: { userId: 1, send: (m) => sent.push(m) },
        process: { exitCode: null, signalCode: null, pid: 1 },
        cumulativeTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    };
    __test__.handleEvent(session, {
        type: 'system', subtype: 'hook_response',
        hook_id: 'ss', hook_name: 'SessionStart', hook_event: 'SessionStart',
        outcome: 'success',
        output: JSON.stringify({ systemMessage: 'Linked to task X' }),
    });
    // Expect TWO status messages: promoted system_message first, then generic hook_response.
    assertEqual('9b. system_message promoted first', sent[0]?.text, 'system_message');
    assertEqual('9b. system_message content', sent[0]?.content, 'Linked to task X');
    assertEqual('9b. hook_response still emitted', sent[1]?.text, 'hook_response');
}

/* 10. handleEvent: compact_boundary emits status */
{
    const sent = [];
    const session = {
        sessionId: 's3',
        inFlight: false,
        queue: [],
        status: 'idle',
        writer: { userId: 1, send: (m) => sent.push(m) },
        process: { exitCode: null, signalCode: null, pid: 1 },
        cumulativeTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    };
    __test__.handleEvent(session, {
        type: 'compact_boundary',
        compact_metadata: { trigger: 'auto', pre_compact_tokens: 150000, post_compact_tokens: 40000 },
    });
    assertEqual('10. compact_boundary emits status', sent[0]?.kind, 'status');
    assertEqual('10. compact_boundary text flag', sent[0]?.text, 'compact_boundary');
    assertEqual('10. compact_boundary trigger passed through', sent[0]?.compactMetadata?.trigger, 'auto');
}

/* 11. handleEvent: error event emits error + flips inFlight off, marks idle */
{
    const sent = [];
    const session = {
        sessionId: 's4',
        inFlight: true,
        status: 'running',
        queue: [],
        writer: { userId: 1, send: (m) => sent.push(m) },
        process: { exitCode: null, signalCode: null, pid: 1 },
        idleTimer: null,
        currentPromptTemps: null,
        cumulativeTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    };
    __test__.handleEvent(session, { type: 'error', error: { message: 'bad' } });
    assertEqual('11. error event emits error kind', sent[0]?.kind, 'error');
    assertEqual('11. error event resets inFlight', session.inFlight, false);
    assertEqual('11. error event marks idle', session.status, 'idle');
}

/* 12. handleEvent: error during aborted session keeps aborted status */
{
    const sent = [];
    const session = {
        sessionId: 's5',
        inFlight: true,
        status: 'aborted',
        queue: [],
        writer: { userId: 1, send: (m) => sent.push(m) },
        process: { exitCode: null, signalCode: null, pid: 1 },
        idleTimer: null,
        currentPromptTemps: null,
        cumulativeTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    };
    __test__.handleEvent(session, { type: 'error', message: 'late' });
    assertEqual('12. aborted status preserved across error', session.status, 'aborted');
}

/* 13. submitPrompt queues when inFlight, writes when idle */
{
    const written = [];
    const session = {
        sessionId: 's6',
        inFlight: false,
        status: 'idle',
        queue: [],
        process: {
            stdin: { write: (p) => { written.push(p); } },
            exitCode: null,
            signalCode: null,
            pid: 1,
        },
    };
    __test__.submitPrompt(session, { text: 'first', tempImagePaths: [], tempDir: null });
    assertEqual('13. idle submit writes immediately', written.length, 1);
    assertEqual('13. first payload contains text', written[0].includes('first'), true);
    assertEqual('13. submit flipped inFlight', session.inFlight, true);
    assertEqual('13. submit marked running', session.status, 'running');

    __test__.submitPrompt(session, { text: 'second', tempImagePaths: [], tempDir: null });
    assertEqual('13. busy submit queues', session.queue.length, 1);
    assertEqual('13. queued entry unchanged', session.queue[0].text, 'second');
    assertEqual('13. busy submit does not write', written.length, 1);
}

/* 14. drainQueue pulls next prompt when idle */
{
    const written = [];
    const session = {
        sessionId: 's7',
        inFlight: false,
        status: 'idle',
        queue: [{ text: 'next', tempImagePaths: [], tempDir: null }],
        process: {
            stdin: { write: (p) => { written.push(p); } },
            exitCode: null,
            signalCode: null,
            pid: 1,
        },
    };
    __test__.drainQueue(session);
    assertEqual('14. drainQueue writes next', written.length, 1);
    assertEqual('14. queue consumed', session.queue.length, 0);
    assertEqual('14. inFlight now true', session.inFlight, true);
}

reset();

if (failed > 0) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
}
console.log('\nall tests passed');
