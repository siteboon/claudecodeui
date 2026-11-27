import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAntigravityRuntime } from '@/modules/providers/list/antigravity/antigravity-runtime.provider.js';
function fixture() {
 const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
 const messages: any[] = [];
 const runtime = createAntigravityRuntime({ spawnProcess: () => child as never });
 const run = runtime.run('probe', {sessionId:'app'}, {send:x=>messages.push(x)}, {
 resolveProviderSessionId:()=>null,resolveResumeModel:async()=>undefined,getProviderModels:async()=>({OPTIONS:[],DEFAULT:''}),isProviderInstalled:async()=>true,
 normalizeMessage:(text:any,id:any)=>[{kind:'stream_delta',content:text,sessionId:id,provider:'antigravity'}] as any,
 });
 const emit=(event:any)=>child.stdout.write(JSON.stringify(event)+'\n');
 return {child,messages,runtime,run,emit};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
import { AntigravityProviderAuth } from '@/modules/providers/list/antigravity/antigravity-auth.provider.js';
import { AntigravityProviderModels } from '@/modules/providers/list/antigravity/antigravity-models.provider.js';
import { chmod } from 'node:fs/promises';
test('protocol-derived errors respect the stderr diagnostic cap',async()=>{
 const f=fixture();const rejected=assert.rejects(f.run);await tick();f.emit({event:'init',conversation_id:'native'});f.emit({event:'result',result:{conversation_id:'native',status:'ERROR',error:'x'.repeat(100000)}});f.child.emit('close',1,null);await rejected;const error=f.messages.find(x=>x.kind==='error');assert.equal(error.content.length,65536);f.child.stdin.destroy();f.child.stdout.destroy();f.child.stderr.destroy();
});
test('auth and catalog accept the same slow model discovery',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(), 'agy-auth-delay-'));const old=process.env.AGY_CLI_PATH;try{const script = path.join(root, 'probe.cjs');
 const executable = path.join(root, process.platform === 'win32' ? 'agy.cmd' : 'agy');
 const program = "if(process.argv.includes('--version'))console.log('1.0.0');else setTimeout(()=>console.log('slow-model\\tSlow Model'),12000);\n";
 if (process.platform === 'win32') {
   await writeFile(script, program);
   await writeFile(executable, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
 } else {
   await writeFile(executable, `#!${process.execPath}\n${program}`);
   await chmod(executable, 0o755);
 }
 process.env.AGY_CLI_PATH=executable;
 const [auth,catalog]=await Promise.all([new AntigravityProviderAuth().getStatus(),new AntigravityProviderModels().getSupportedModels()]);assert.equal(auth.authenticated,true);assert.equal(catalog.OPTIONS[0].value,'slow-model');
 }finally{if(old===undefined)delete process.env.AGY_CLI_PATH;else process.env.AGY_CLI_PATH=old;await rm(root,{recursive:true,force:true});}
});

