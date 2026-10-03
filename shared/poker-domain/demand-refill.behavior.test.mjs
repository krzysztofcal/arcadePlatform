import test from "node:test";
import assert from "node:assert/strict";
import { attemptDemandRefill } from "./demand-refill.mjs";

test("failed refill rolls back its savepoint and leaves original funding transaction usable", async () => {
  const queries = [];
  const tx = { unsafe: async (sql) => {
    queries.push(sql);
    if (sql.includes("select public.poker_bot_pool_refill_demand")) throw new Error("identity_mismatch");
    return [];
  } };
  await assert.rejects(attemptDemandRefill({ tx, buyIn: 100, poolClass: "NORMAL", fundingDemandId: "funding:1", requiredDebitCh: 100 }), /identity_mismatch/);
  assert.match(queries[2], /rollback to savepoint/);
  assert.match(queries[3], /release savepoint/);
});

test("no positive legal demand or RESTRICTED class never reaches DB MINT primitive", async () => {
  const tx = { unsafe: () => { throw new Error("must_not_query"); } };
  for (const [poolClass, requiredDebitCh] of [["RESTRICTED",100],["NORMAL",0],["TREASURY",100]]) {
    assert.equal((await attemptDemandRefill({ tx, buyIn: 100, poolClass, fundingDemandId: "funding:1", requiredDebitCh })).status, "invalid_demand");
  }
});

import { seedBotsForJoin } from "./bots.mjs";

test("initial seed refill uses actual planned seats and exact funding identities; zero seed never refills", async () => {
  const seats = [{user_id:"human",seat_no:1,is_bot:false,status:"ACTIVE"}];
  const tx = { unsafe: async (sql, params) => {
    if (sql.includes("select user_id, seat_no")) return seats;
    if (sql.includes("insert into public.poker_seats")) return [{seat_no:params[2]}];
    return [];
  }, savepoint: async (_name,fn) => fn(tx) };
  const demands = [], fundings = [];
  const options = {tx,tableId:"seed-table",maxPlayers:6,tableStakes:{sb:1,bb:2},buyInChips:100,
    cfg:{enabled:true,defaultProfile:"NORMAL"},humanUserId:"human",poolClass:"NORMAL",
    postTransaction:async p=>{fundings.push(p);},demandRefillFn:async p=>{demands.push(p);return {status:"no_op"};}};
  for (const targetBotCount of [1,2,4]) {
    demands.length=0;fundings.length=0;
    const result=await seedBotsForJoin({...options,targetBotCount});
    assert.equal(result.length,targetBotCount);
    assert.equal(demands.length,1);
    assert.equal(demands[0].requiredDebitCh,targetBotCount*100);
    assert.equal(demands[0].fundingDemandId,fundings.map(f=>f.idempotencyKey).join("|"));
  }
  demands.length=0;
  await seedBotsForJoin({...options,targetBotCount:0});
  assert.equal(demands.length,0);
});
