import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionEnv } from '../scripts/stage-db-migrate.mjs';
import { prepareConnections, previewValue, verifyMetadata, migrate } from '../scripts/ops/stage-secrets-termux.mjs';
const ref = 'krydukthwdvccggbyjfw';
const variable = (value, key = 'SUPABASE_DB_URL') => ({key, is_secret:false, values:[{context:'deploy-preview',value}]});
const source = variable(`postgresql://postgres.${ref}:fake%40%3A%2F%25@aws-0-eu.pooler.supabase.com:6543/postgres?sslmode=require`);
test('only exact readable deploy-preview source; session/direct preserve encoded password', () => {
 const urls = prepareConnections(previewValue(source, source.key), `https://${ref}.supabase.co`, ref);
 const session = new URL(urls.SUPABASE_STAGE_DB_URL), direct = new URL(urls.SUPABASE_STAGE_DIRECT_DB_URL);
 assert.equal(session.port,'5432'); assert.equal(direct.port,'5432');
 assert.equal(decodeURIComponent(session.password),'fake@:/%'); assert.equal(session.password,direct.password);
 assert.equal(direct.hostname,`db.${ref}.supabase.co`); assert.equal(direct.username,'postgres');
 assert.equal(connectionEnv(direct.href,ref).PGUSER,'postgres');
 assert.equal(session.search,''); assert.equal(direct.search,'?sslmode=require');
 for(const invalid of [{...source,is_secret:true},{...source,values:[{context:'all',value:'x'}]},{...source,values:[{context:'deploy-preview',context_parameter:'main',value:'x'}]},{...source,values:[{context:'production',value:'x'}]},{...source,values:[...source.values,...source.values]}]) assert.throws(()=>previewValue(invalid,source.key));
 for(const invalid of [source.values[0].value.replace(ref,'production'),source.values[0].value.replace('6543','9999'),source.values[0].value+'&host=evil',source.values[0].value.replace('aws-0-eu.pooler.supabase.com','evil.com')]) assert.throws(()=>prepareConnections(invalid,`https://${ref}.supabase.co`,ref));
 assert.throws(()=>prepareConnections(source.values[0].value,'https://production.supabase.co',ref));
});
test('metadata must confirm a fresh write, not an old existing secret', () => {
 const previous={name:'A',updated_at:'2026-11-05T10:00:00Z'};
 assert.equal(verifyMetadata({name:'A',updated_at:'2026-11-05T10:00:01Z'},'A',previous),true);
 assert.throws(()=>verifyMetadata({name:'A',updated_at:'2026-11-04T10:00:00Z'},'A',previous));
 assert.throws(()=>verifyMetadata(previous,'A',previous));
 assert.equal(verifyMetadata({name:'A',updated_at:'2026-11-05T10:00:01Z'},'A',null),true);
 assert.throws(()=>verifyMetadata({name:'B',updated_at:'2026-11-05T10:00:01Z'},'A',previous));
});
test('preflight failure writes nothing; partial writes retained and reported without values', async () => {
 let writes=[];
 const deps={preflight:async()=>{throw Error('private token')},write:async(k)=>writes.push(k),metadata:async()=>{}};
 const report=await migrate({A:'never-print-this'},deps);
 assert.deepEqual(writes,[]); assert.equal(report.A,'STOP'); assert.ok(!JSON.stringify(report).includes('private'));
 let n=0;
 const partial=await migrate({A:'secret-a',B:'secret-b'}, {...deps,preflight:async()=>{},write:async(k)=>{writes.push(k);if(++n===2)throw Error('secret-b')},metadata:async(k)=>writes.includes(k)?{name:k,updated_at:'2026-11-05T10:00:01Z'}:null});
 assert.deepEqual(writes,['A','B']); assert.equal(partial.A,'PASS');assert.equal(partial.B,'STOP');
 assert.ok(!JSON.stringify(partial).includes('secret-'));
});
