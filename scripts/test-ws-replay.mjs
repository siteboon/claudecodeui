#!/usr/bin/env node
/**
 * Unit test for server/ws-writer.js WebSocketWriter buffer-replay behaviour.
 *
 * Covers:
 *   1. send() while ws OPEN → delivers immediately
 *   2. send() while ws CLOSED → enqueues
 *   3. updateWebSocket(newWs OPEN) → flushes queue in order
 *   4. send() after swap while new ws OPEN → drains queue then sends
 *   5. overflow → oldest-drop, single warn
 *   6. newRawWs in CONNECTING state → flush deferred until 'open' event
 *   7. ws.send throw during flush → re-queued for next attempt
 *
 * Run: node scripts/test-ws-replay.mjs
 * Exit code 0 on success, 1 on failure.
 */

import { WebSocketWriter } from '../server/ws-writer.js';

const WS_OPEN = 1;
const WS_CONNECTING = 0;
const WS_CLOSED = 3;

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

function makeFakeWs(readyState = WS_OPEN, { throwOnNthSend = null } = {}) {
    const sent = [];
    let openListener = null;
    let sendCount = 0;
    return {
        get readyState() { return this._readyState; },
        set readyState(v) { this._readyState = v; },
        _readyState: readyState,
        sent,
        send(data) {
            sendCount++;
            if (throwOnNthSend !== null && sendCount === throwOnNthSend) {
                throw new Error('simulated send failure');
            }
            sent.push(data);
        },
        once(event, fn) {
            if (event === 'open') openListener = fn;
        },
        fireOpen() { openListener?.(); },
    };
}

function silentLogger() {
    return {
        warnCalls: 0,
        warn(..._args) { this.warnCalls++; },
    };
}

/* 1. send() while OPEN → immediate delivery */
{
    const ws = makeFakeWs(WS_OPEN);
    const w = new WebSocketWriter(ws, 1);
    w.send({ kind: 'hello' });
    assertEqual('1. OPEN send delivers', ws.sent, ['{"kind":"hello"}']);
    assertEqual('1. OPEN send leaves no pending', w.pending.length, 0);
}

/* 2. send() while CLOSED → enqueues, no delivery */
{
    const ws = makeFakeWs(WS_CLOSED);
    const w = new WebSocketWriter(ws, 1);
    w.send({ kind: 'a' });
    w.send({ kind: 'b' });
    assertEqual('2. CLOSED send no delivery', ws.sent, []);
    assertEqual('2. CLOSED send enqueued', w.pending, ['{"kind":"a"}', '{"kind":"b"}']);
}

/* 3. updateWebSocket(OPEN) flushes in order */
{
    const oldWs = makeFakeWs(WS_CLOSED);
    const newWs = makeFakeWs(WS_OPEN);
    const w = new WebSocketWriter(oldWs, 1);
    w.send({ kind: 'a' });
    w.send({ kind: 'b' });
    w.send({ kind: 'c' });
    w.updateWebSocket(newWs);
    assertEqual('3. flush on swap delivers queue in order', newWs.sent, [
        '{"kind":"a"}',
        '{"kind":"b"}',
        '{"kind":"c"}',
    ]);
    assertEqual('3. flush empties pending', w.pending.length, 0);
}

/* 4. send() after swap drains queue before new message */
{
    const oldWs = makeFakeWs(WS_CLOSED);
    const newWs = makeFakeWs(WS_OPEN);
    const w = new WebSocketWriter(oldWs, 1);
    w.send({ kind: 'queued1' });
    w.send({ kind: 'queued2' });
    // simulate swap without triggering internal flush by bypassing updateWebSocket
    w.ws = newWs;
    w.send({ kind: 'live' });
    assertEqual('4. post-swap send drains queue then sends live', newWs.sent, [
        '{"kind":"queued1"}',
        '{"kind":"queued2"}',
        '{"kind":"live"}',
    ]);
}

/* 5. overflow drops oldest, warns once */
{
    const ws = makeFakeWs(WS_CLOSED);
    const logger = silentLogger();
    const w = new WebSocketWriter(ws, 1, { bufferCap: 3, logger });
    w.send({ kind: 'a' });
    w.send({ kind: 'b' });
    w.send({ kind: 'c' });
    w.send({ kind: 'd' }); // evicts 'a'
    w.send({ kind: 'e' }); // evicts 'b'
    assertEqual('5. overflow keeps newest within cap', w.pending, [
        '{"kind":"c"}',
        '{"kind":"d"}',
        '{"kind":"e"}',
    ]);
    assertEqual('5. overflow warns only once per episode', logger.warnCalls, 1);
}

/* 6. swap to CONNECTING defers flush until 'open' fires */
{
    const oldWs = makeFakeWs(WS_CLOSED);
    const newWs = makeFakeWs(WS_CONNECTING);
    const w = new WebSocketWriter(oldWs, 1);
    w.send({ kind: 'q' });
    w.updateWebSocket(newWs);
    assertEqual('6. CONNECTING new ws delays flush', newWs.sent, []);
    assertEqual('6. queue retained', w.pending.length, 1);
    newWs._readyState = WS_OPEN;
    newWs.fireOpen();
    assertEqual('6. open event drains queue', newWs.sent, ['{"kind":"q"}']);
}

/* 7. send throw during flush stops + re-queues failed + remaining in order */
{
    // 3 queued msgs; throw on the 2nd send call of the new ws during flush.
    // Must NOT keep flushing past the failure — that would reorder `c` ahead
    // of the retried `b` on the wire.
    const oldWs = makeFakeWs(WS_CLOSED);
    const newWs = makeFakeWs(WS_OPEN, { throwOnNthSend: 2 });
    const logger = silentLogger();
    const w = new WebSocketWriter(oldWs, 1, { logger });
    w.send({ kind: 'a' });
    w.send({ kind: 'b' });
    w.send({ kind: 'c' });
    w.updateWebSocket(newWs);
    assertEqual('7. first delivered, flush stops on throw', newWs.sent, [
        '{"kind":"a"}',
    ]);
    assertEqual('7. failed + remaining re-queued in order', w.pending, [
        '{"kind":"b"}',
        '{"kind":"c"}',
    ]);
    assertEqual('7. flush logged warn for failure', logger.warnCalls >= 1, true);
}

/* 8. ws flips non-OPEN mid-flush → remaining messages re-queued without throw */
{
    const oldWs = makeFakeWs(WS_CLOSED);
    const newWs = makeFakeWs(WS_OPEN);
    const w = new WebSocketWriter(oldWs, 1);
    w.send({ kind: 'a' });
    w.send({ kind: 'b' });
    w.send({ kind: 'c' });
    // Monkey-patch: after first send, flip readyState to CLOSED so the
    // flush loop hits the readyState guard, not the try/catch path.
    const origSend = newWs.send.bind(newWs);
    newWs.send = (data) => {
        origSend(data);
        newWs._readyState = WS_CLOSED;
    };
    w.updateWebSocket(newWs);
    assertEqual('8. first message delivered before ws flipped closed', newWs.sent, ['{"kind":"a"}']);
    assertEqual('8. remaining re-queued after flip', w.pending, ['{"kind":"b"}', '{"kind":"c"}']);
}

/* 9. setSessionId / getSessionId accessors */
{
    const w = new WebSocketWriter(makeFakeWs(WS_OPEN), 1);
    assertEqual('9. initial sessionId is null', w.getSessionId(), null);
    w.setSessionId('sess-abc');
    assertEqual('9. setSessionId stored', w.getSessionId(), 'sess-abc');
}

/* 10. updateWebSocket with empty queue is a bare swap */
{
    const oldWs = makeFakeWs(WS_OPEN);
    const newWs = makeFakeWs(WS_OPEN);
    const w = new WebSocketWriter(oldWs, 1);
    w.updateWebSocket(newWs); // pending is empty → no-op path
    assertEqual('10. empty-queue swap does nothing', newWs.sent, []);
    assertEqual('10. ws reference replaced', w.ws, newWs);
}

/* 11b. send() after mid-flush close: current msg enqueues, not lost */
{
    // Queue [a, b, c], swap to ws that flips CLOSED after first send during
    // flush. Then call send(live) — live must land on pending (behind the
    // re-queued b, c), not be silently dropped by ws.send on closed socket.
    const oldWs = makeFakeWs(WS_CLOSED);
    const newWs = makeFakeWs(WS_OPEN);
    const w = new WebSocketWriter(oldWs, 1);
    w.send({ kind: 'a' });
    w.send({ kind: 'b' });
    w.send({ kind: 'c' });
    // Bypass updateWebSocket to simulate a writer that had its raw ws
    // mutated externally (e.g. ping/pong error flipped it) between calls.
    w.ws = newWs;
    const origSend = newWs.send.bind(newWs);
    newWs.send = (data) => {
        origSend(data);
        newWs._readyState = WS_CLOSED;
    };
    w.send({ kind: 'live' });
    assertEqual('11b. first message flushed before ws flipped', newWs.sent, ['{"kind":"a"}']);
    assertEqual('11b. live msg enqueued behind re-queued survivors', w.pending, [
        '{"kind":"b"}',
        '{"kind":"c"}',
        '{"kind":"live"}',
    ]);
}

/* 11. flush send throw with non-string error exercises err fallback */
{
    const oldWs = makeFakeWs(WS_CLOSED);
    const newWs = makeFakeWs(WS_OPEN);
    // Throw a primitive (no .message) so `err?.message || err` falls through.
    newWs.send = () => { throw 'bare string failure'; };
    const logger = silentLogger();
    const w = new WebSocketWriter(oldWs, 1, { logger });
    w.send({ kind: 'x' });
    w.updateWebSocket(newWs);
    assertEqual('11. bare-string throw re-queues', w.pending, ['{"kind":"x"}']);
    assertEqual('11. bare-string throw warns', logger.warnCalls, 1);
}

if (failed > 0) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
}
console.log('\nall tests passed');
