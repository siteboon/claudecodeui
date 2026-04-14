import { describe, it, expect } from 'vitest';
import { SessionRouter } from './session.js';
describe('SessionRouter', () => {
    it('register and has', () => {
        const router = new SessionRouter();
        expect(router.has('s1')).toBe(false);
        router.register('s1');
        expect(router.has('s1')).toBe(true);
    });
    it('unregister removes session', () => {
        const router = new SessionRouter();
        router.register('s1');
        router.unregister('s1');
        expect(router.has('s1')).toBe(false);
    });
    it('push and iterate yields messages in order', async () => {
        const router = new SessionRouter();
        router.register('s1');
        router.push('s1', { type: 'assistant', content: 'hello', session_id: 's1' });
        router.push('s1', { type: 'assistant', content: ' world', session_id: 's1' });
        router.finish('s1');
        const msgs = [];
        for await (const msg of router.iterate('s1')) {
            msgs.push(msg);
        }
        expect(msgs).toHaveLength(3);
        expect(msgs[0]).toEqual({ type: 'assistant', content: 'hello', session_id: 's1' });
        expect(msgs[1]).toEqual({ type: 'assistant', content: ' world', session_id: 's1' });
        expect(msgs[2]).toMatchObject({ type: 'result', session_id: 's1', is_error: false, text: 'hello world' });
    });
    it('finish aggregates full text from assistant chunks', async () => {
        const router = new SessionRouter();
        router.register('s1');
        router.push('s1', { type: 'assistant', content: 'a', session_id: 's1' });
        router.push('s1', { type: 'tool_use', name: 'shell', input: {}, id: 't1', status: 'running', session_id: 's1' });
        router.push('s1', { type: 'assistant', content: 'b', session_id: 's1' });
        router.finish('s1');
        const msgs = [];
        for await (const msg of router.iterate('s1'))
            msgs.push(msg);
        const result = msgs.find(m => m.type === 'result');
        expect(result.type === 'result' && result.text).toBe('ab');
    });
    it('finish with isError=true sets is_error on result', async () => {
        const router = new SessionRouter();
        router.register('s1');
        router.finish('s1', true);
        const msgs = [];
        for await (const msg of router.iterate('s1'))
            msgs.push(msg);
        expect(msgs[0]).toMatchObject({ type: 'result', is_error: true });
    });
    it('iterate on unknown session returns immediately', async () => {
        const router = new SessionRouter();
        const msgs = [];
        for await (const msg of router.iterate('nonexistent'))
            msgs.push(msg);
        expect(msgs).toHaveLength(0);
    });
    it('push to unknown session is a no-op', () => {
        const router = new SessionRouter();
        // Should not throw
        router.push('nonexistent', { type: 'assistant', content: 'x', session_id: 'nonexistent' });
    });
    it('yields messages pushed after iterate starts', async () => {
        const router = new SessionRouter();
        router.register('s1');
        const collected = [];
        const done = (async () => {
            for await (const msg of router.iterate('s1'))
                collected.push(msg);
        })();
        // Push asynchronously
        await new Promise(r => setTimeout(r, 10));
        router.push('s1', { type: 'assistant', content: 'delayed', session_id: 's1' });
        await new Promise(r => setTimeout(r, 10));
        router.finish('s1');
        await done;
        expect(collected).toHaveLength(2);
        expect(collected[0]).toMatchObject({ type: 'assistant', content: 'delayed' });
        expect(collected[1]).toMatchObject({ type: 'result' });
    });
});
