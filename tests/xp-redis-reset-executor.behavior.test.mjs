import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildLegacyXpResetPlan} from '../scripts/ops/xp-redis-reset-plan.mjs';
import {executeReset,readJournal,validateScope,verifyRevocation} from '../scripts/ops/xp-redis-reset-execute.mjs';
const hash='a'.repeat(64);
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xp-reset-executor-'));fs.chmodSync(directory,0o700);
 const records=[1,2].map(n=>({key:'kcswh:xp:v2:total:fixture-'+n,type:'string',value:String(n),pttl:-1,capturedAtMs:1000}));
 const scope={endpointHash:hash,operations:records.map(r=>({key:r.key,type:r.type,operation:'DEL'}))};
 const plan=buildLegacyXpResetPlan(records);const state=new Map(records.map(r=>[r.key,{...r}]));let mutations=0;
 const observe=async key=>state.get(key)||{key,type:'none',pttl:-2,capturedAtMs:2000};
 const command=async cmd=>{mutations++;const key=cmd[3];if(state.get(key)?.value!==JSON.parse(cmd[5]))throw Error('changed');state.delete(key);return 'DELETED';};
 const options={snapshot:{endpointHash:hash,records},scope,manifestHash:plan.manifestHash,journal:path.join(directory,'journal.jsonl'),boundary:directory,observe,command};
 return {directory,records,scope,state,options,mutations:()=>mutations,clean:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
test('default dry-run compares every key and never creates a journal or mutates',async()=>{
 const f=fixture();try{assert.equal((await executeReset(f.options)).mode,'dry-run');assert.equal(f.mutations(),0);assert.equal(fs.existsSync(f.options.journal),false);}finally{f.clean();}
});
test('durable intent/result journal resumes only proven successes without repeating CAS',async()=>{
 const f=fixture();try{
  assert.equal((await executeReset({...f.options,apply:true})).completed,2);
  const journal=readJournal(f.options.journal,{boundary:f.directory});assert.equal(journal.filter(r=>r.kind==='intent').length,2);assert.equal(journal.filter(r=>r.kind==='done').length,2);
  assert.equal((await executeReset({...f.options,apply:true})).completed,2);assert.equal(f.mutations(),2);
 }finally{f.clean();}
});
test('lost response leaves a durable unresolved intent and stops before next key or replay',async()=>{
 const f=fixture();try{
  let sent=0;const command=async cmd=>{sent++;f.state.delete(cmd[3]);throw Error('network outcome unknown');};
  await assert.rejects(executeReset({...f.options,apply:true,command}),/reset_operation_uncertain/);
  assert.equal(sent,1);assert.equal(f.state.size,1);
  await assert.rejects(executeReset({...f.options,apply:true}),/reset_journal_unresolved/);assert.equal(f.mutations(),0);
 }finally{f.clean();}
});
test('scope, snapshot hash, type/value drift and partial journal are NO-GO',async()=>{
 const f=fixture();try{
  assert.throws(()=>validateScope(f.options.snapshot,{...f.scope,operations:[...f.scope.operations,{key:'chips:wallet',type:'string',operation:'DEL'}]}),/reset_scope/);
  await assert.rejects(executeReset({...f.options,manifestHash:'b'.repeat(64)}),/reset_manifest_changed/);
  f.state.set(f.records[0].key,{...f.records[0],value:'changed'});await assert.rejects(executeReset(f.options),/reset_content_changed/);
  fs.writeFileSync(f.options.journal,'{"kind":"header"}',{mode:0o600});await assert.rejects(executeReset({...f.options,apply:true}),/reset_journal_corrupt/);
  assert.equal(f.mutations(),0);
 }finally{f.clean();}
});
test('journal symlinks and insecure permissions deny before effects',async()=>{
 const f=fixture();try{
  fs.writeFileSync(f.options.journal,'', {mode:0o644});await assert.rejects(executeReset({...f.options,apply:true}),/reset_file_unsafe/);
  fs.unlinkSync(f.options.journal);fs.symlinkSync(path.join(f.directory,'foreign'),f.options.journal);
  await assert.rejects(executeReset({...f.options,apply:true}));assert.equal(f.mutations(),0);
 }finally{f.clean();}
});
test('kernel lock excludes a concurrent executor; verify is read-only and requires a complete journal',async()=>{
 const f=fixture();try{
  await assert.rejects(executeReset({...f.options,apply:true,verifyOnly:true}),/reset_journal_incomplete/);
  let release,started;const waiting=new Promise(r=>{started=r;});const gate=new Promise(r=>{release=r;});
  const first=executeReset({...f.options,apply:true,command:async cmd=>{started();await gate;return f.options.command(cmd);}});
  await waiting;await assert.rejects(executeReset({...f.options,apply:true}),/reset_executor_busy/);
  release();await first;
  assert.equal((await executeReset({...f.options,apply:true,verifyOnly:true})).mode,'verify');assert.equal(f.mutations(),2);
 }finally{f.clean();}
});

test('only an actual authentication rejection proves old credential revocation',()=>{
 verifyRevocation({status:401,body:{error:'WRONGPASS invalid or missing auth token'}});
 for(const response of [{status:200,body:{result:'PONG'}},{status:503,body:{error:'unavailable'}},{status:401,body:{error:'unknown proxy failure'}}])assert.throws(()=>verifyRevocation(response),/reset_old_credential_not_revoked/);
});
