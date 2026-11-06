import assert from 'node:assert/strict';
import test from 'node:test';
import { planPreviewRetention } from '../scripts/netlify-preview-retention-plan.mjs';
const siteId='f7e19a84-28f7-41f7-978a-f3b4552a404d';
const id=n=>String(n).padStart(24,'0');
const dep=(n,patch={})=>({id:id(n),reviewId:1,context:'deploy-preview',state:'ready',created:'2026-10-01T00:00:00Z',...patch});
function plan(rows,prs={'1':{state:'CLOSED',closedAt:'2026-10-02T00:00:00Z'}},rules=[{deployId:id(999),reason:'required_rollback'}],asOf='2026-10-10T00:00:00Z') {
 return planPreviewRetention({inventory:{siteId,complete:true,published:id(1000),rows},pullRequests:prs,pins:{siteId,rules},asOf});
}
test('Production, published, Stage/APK pins and branch context always survive age',()=>{
 const r=plan([dep(1,{context:'production'}),dep(1000),dep(2),dep(3,{context:'branch-deploy'}),dep(4,{locked:true})],undefined,[{deployId:id(2),reason:'apk'}]);
 assert.ok(r.rows.every(x=>x.decision==='KEEP'));assert.equal(r.applyAuthorized,false);
});
test('closed PR grace is measured from closure, exactly seven days qualifies',()=>{
 assert.equal(plan([dep(1)],undefined,undefined,'2026-10-08T23:59:59Z').rows[0].reason,'grace_period');
 assert.equal(plan([dep(1)],undefined,undefined,'2026-10-09T00:00:00Z').rows[0].decision,'CANDIDATE_ESTIMATE');
});
test('open PR retains current successful alias even when HEAD differs; older version waits seven days after replacement',()=>{
 const rows=[dep(1),dep(2,{created:'2026-10-05T00:00:00Z',sha:'previous-head'})];const prs={'1':{state:'OPEN',headRefOid:'new-head'}};
 assert.equal(plan(rows,prs).rows.find(x=>x.id===id(1)).reason,'grace_period');
 const r=plan(rows,prs,undefined,'2026-10-12T00:00:00Z');assert.equal(r.rows.find(x=>x.id===id(1)).decision,'CANDIDATE_ESTIMATE');assert.equal(r.rows.find(x=>x.id===id(2)).reason,'open_pr_current_alias');
});
test('reopened PR is treated as open; missing PR/closure/date data fail closed',()=>{
 assert.equal(plan([dep(1)],{'1':{state:'OPEN',closedAt:'2026-10-01T00:00:00Z'}}).rows[0].reason,'open_pr_current_alias');
 for(const pr of [{}, {'1':{state:'CLOSED'}}, {'1':{state:'CLOSED',closedAt:'future'}}])assert.equal(plan([dep(1)],pr).rows[0].decision,'KEEP');
 assert.equal(plan([dep(1,{created:'invalid'})]).rows[0].decision,'KEEP');
 assert.ok(plan([dep(1,{created:'invalid'}),dep(2)]).rows.every(x=>x.decision==='KEEP'));
});
test('pinned older closed-PR version protects latest alias against fallback',()=>{
 const r=plan([dep(1),dep(2,{created:'2026-10-02T00:00:00Z'})],undefined,[{deployId:id(1),reason:'rollback'}]);
 assert.equal(r.rows.find(x=>x.id===id(2)).reason,'alias_fallback_guard');
});
test('eligible groups plan oldest first; inputs remain unchanged and there is no apply switch',()=>{
 const rows=[dep(2,{created:'2026-10-02T00:00:00Z'}),dep(1)];const before=JSON.stringify(rows);const r=plan(rows);
 assert.deepEqual(r.rows.map(x=>x.id),[id(1),id(2)]);assert.equal(JSON.stringify(rows),before);assert.equal(r.liveLocksAndAliasesRechecked,false);
});
test('incomplete inventory, wrong site, missing protections and duplicate IDs refuse a plan',()=>{
 const base={inventory:{siteId,complete:true,rows:[dep(1)]},pullRequests:{},pins:{siteId,rules:[{deployId:id(99),reason:'pin'}]},asOf:'2026-10-10T00:00:00Z'};
 for(const patch of [{inventory:{...base.inventory,complete:false}},{inventory:{...base.inventory,siteId:'other'}},{pins:{siteId,rules:[]}},{inventory:{...base.inventory,rows:[dep(1),dep(1)]}}])assert.throws(()=>planPreviewRetention({...base,...patch}),/retention_/);
});
