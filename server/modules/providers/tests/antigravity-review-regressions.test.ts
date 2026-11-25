import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createAntigravityRuntime } from '@/modules/providers/list/antigravity/antigravity-runtime.provider.js';
function fixture() {
 const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
 const messages: any[] = [];
 const runtime = createAntigravityRuntime({ spawnProcess: () => child as never, drainTimeoutMs: 20 });
 const run = runtime.run('probe', {sessionId:'app'}, {send:x=>messages.push(x)}, {
 resolveProviderSessionId:()=>null,resolveResumeModel:async()=>undefined,getProviderModels:async()=>({OPTIONS:[],DEFAULT:''}),isProviderInstalled:async()=>true,
 normalizeMessage:(text:any,id:any)=>[{kind:'stream_delta',content:text,sessionId:id,provider:'antigravity'}] as any,
 });
 const emit=(event:any)=>child.stdout.write(JSON.stringify(event)+'\n');
 return {child,messages,runtime,run,emit};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('exit followed by abort settles after a bounded pipe drain',async()=>{
 const f=fixture();let settled=false;f.run.then(()=>settled=true,()=>settled=true);await tick();
 f.emit({event:'init',conversation_id:'native'});f.emit({event:'result',result:{conversation_id:'native',status:'SUCCESS',response:'ok'}});
 try { f.child.emit('exit',0,null);assert.equal(f.runtime.abort('app'),true); await new Promise(resolve=>setTimeout(resolve,80));assert.equal(settled,true);assert.equal(f.child.stdout.destroyed,true); }
 finally {try {f.child.emit('close',0,null);await f.run;} finally {f.child.stdin.destroy();f.child.stdout.destroy();f.child.stderr.destroy();}}
});
test('control-only deltas retain the successful terminal response',async()=>{
 const f=fixture();await tick();f.emit({event:'init',conversation_id:'native'});f.emit({event:'step_update',step_update:{step_type:'agent_response',text_delta:'<WAITING_FOR_EVENTS></WAITING_FOR_EVENTS>'}});
 f.emit({event:'result',result:{conversation_id:'native',status:'SUCCESS',response:'answer'}});f.child.emit('close',0,null);await f.run;
 assert.equal(f.messages.filter(x=>x.kind==='stream_delta').map(x=>x.content).join(''),'answer');console.log('terminal response preserved');f.child.stdin.destroy();f.child.stdout.destroy();f.child.stderr.destroy();
});
