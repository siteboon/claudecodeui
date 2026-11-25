import assert from 'node:assert/strict';
import {act,renderHook} from '@testing-library/react';
import {test,vi} from 'vitest';
import {useSessionStore} from '@/modules/chat/hooks/useSessionStore';
import {useChatRealtimeHandlers} from '@/modules/chat/hooks/useChatRealtimeHandlers';
for (const flushFirst of [false, true]) test(`final supersedes buffered partial text (timer fired: ${flushFirst})`,()=>{
 vi.useFakeTimers();let listener:any;
 const hook=renderHook(()=>{const store=useSessionStore();useChatRealtimeHandlers({isActive:true,subscribe:fn=>{listener=fn;return()=>{}},provider:'claude',selectedSession:{id:'s'} as any,currentSessionId:'s',setTokenBudget:()=>{},pendingPermissionRequests:[],setPendingPermissionRequests:()=>{},lastSeqRef:{current:new Map()},statusCheckSentAtRef:{current:new Map()},requestLatestMessages:async()=>{},sessionStore:store});return store;});
 try{act(()=>listener({kind:'stream_delta',sessionId:'s',provider:'claude',content:'ans'}));if(flushFirst) act(()=>vi.advanceTimersByTime(100));act(()=>listener({id:'final',kind:'text',role:'assistant',sessionId:'s',provider:'claude',content:'answer'}));
 assert.equal(hook.result.current.getMessages('s').length,1);act(()=>vi.advanceTimersByTime(100));assert.equal(hook.result.current.getMessages('s').length,1);act(()=>listener({kind:'stream_end',sessionId:'s',provider:'claude'}));assert.equal(hook.result.current.getMessages('s').length,1);
 }finally{hook.unmount();vi.useRealTimers();}
});
