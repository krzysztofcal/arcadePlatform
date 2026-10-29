import test from "node:test";
import assert from "node:assert/strict";
import { createStreamLog } from "./stream-log.mjs";

test("append assigns monotonic seq and prunes oldest beyond cap", () => {
  const streamLog = createStreamLog({ cap: 2 });
  const a = streamLog.append({ tableId: "t1", frame: { type: "stateSnapshot" }, receiverKey: "u1" });
  const b = streamLog.append({ tableId: "t1", frame: { type: "statePatch" }, receiverKey: "u1" });
  const c = streamLog.append({ tableId: "t1", frame: { type: "statePatch" }, receiverKey: "u1" });

  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(c.seq, 3);

  const replay = streamLog.eventsAfter({ tableId: "t1", lastSeq: 0, receiverKey: "u1" });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "last_seq_out_of_window");
});

test("eventsAfter returns contiguous replay slice or replay-unavailable signal", () => {
  const streamLog = createStreamLog({ cap: 3 });
  streamLog.append({ tableId: "t2", frame: { type: "stateSnapshot" }, receiverKey: "u1" });
  streamLog.append({ tableId: "t2", frame: { type: "statePatch", payload: { n: 1 } }, receiverKey: "u1" });
  streamLog.append({ tableId: "t2", frame: { type: "statePatch", payload: { n: 2 } }, receiverKey: "u1" });

  const inWindow = streamLog.eventsAfter({ tableId: "t2", lastSeq: 1, receiverKey: "u1" });
  assert.equal(inWindow.ok, true);
  assert.deepEqual(inWindow.frames.map((frame) => frame.seq), [2, 3]);

  streamLog.append({ tableId: "t2", frame: { type: "statePatch", payload: { n: 3 } }, receiverKey: "u1" });
  const evicted = streamLog.eventsAfter({ tableId: "t2", lastSeq: 0, receiverKey: "u1" });
  assert.equal(evicted.ok, false);
  assert.equal(evicted.reason, "last_seq_out_of_window");
});


test("eventsAfter isolates replay per receiver key for same table", () => {
  const streamLog = createStreamLog({ cap: 6 });
  streamLog.append({ tableId: "t3", frame: { type: "stateSnapshot", payload: { owner: "a" } }, receiverKey: "sess_a" });
  streamLog.append({ tableId: "t3", frame: { type: "stateSnapshot", payload: { owner: "b" } }, receiverKey: "sess_b" });
  streamLog.append({ tableId: "t3", frame: { type: "statePatch", payload: { owner: "a2" } }, receiverKey: "sess_a" });

  const replayA = streamLog.eventsAfter({ tableId: "t3", lastSeq: 0, receiverKey: "sess_a" });
  const replayB = streamLog.eventsAfter({ tableId: "t3", lastSeq: 1, receiverKey: "sess_b" });

  assert.equal(replayA.ok, true);
  assert.equal(replayB.ok, true);
  assert.deepEqual(replayA.frames.map((frame) => frame.payload.owner), ["a", "a2"]);
  assert.deepEqual(replayB.frames.map((frame) => frame.payload.owner), ["b"]);
});


test("receiver-scoped window is unaffected by unrelated receiver traffic", () => {
  const streamLog = createStreamLog({ cap: 2 });
  const a1 = streamLog.append({ tableId: "t4", frame: { type: "stateSnapshot", payload: { owner: "a1" } }, receiverKey: "sess_a" });
  streamLog.append({ tableId: "t4", frame: { type: "stateSnapshot", payload: { owner: "b1" } }, receiverKey: "sess_b" });
  streamLog.append({ tableId: "t4", frame: { type: "statePatch", payload: { owner: "b2" } }, receiverKey: "sess_b" });
  streamLog.append({ tableId: "t4", frame: { type: "statePatch", payload: { owner: "b3" } }, receiverKey: "sess_b" });

  const replayA = streamLog.eventsAfter({ tableId: "t4", lastSeq: a1.seq - 1, receiverKey: "sess_a" });
  assert.equal(replayA.ok, true);
  assert.deepEqual(replayA.frames.map((frame) => frame.payload.owner), ["a1"]);

  const replayB = streamLog.eventsAfter({ tableId: "t4", lastSeq: 0, receiverKey: "sess_b" });
  assert.equal(replayB.ok, false);
  assert.equal(replayB.reason, "last_seq_out_of_window");
});

test("forgetTable removes only the selected replay stream and is idempotent", () => {
  const streamLog = createStreamLog({ cap: 3 });
  streamLog.append({ tableId: "forgotten", frame: { type: "stateSnapshot" }, receiverKey: "sess_a" });
  streamLog.append({ tableId: "retained", frame: { type: "stateSnapshot" }, receiverKey: "sess_b" });

  assert.equal(streamLog.forgetTable("forgotten"), true);
  assert.equal(streamLog.forgetTable("forgotten"), false);
  assert.equal(streamLog.latestSeq("forgotten"), 0);
  assert.equal(streamLog.latestSeq("retained"), 1);
});

 test("identity-bearing replay requires a fresh snapshot instead of disclosing old identity",()=>{
 for(const type of ["stateSnapshot","statePatch","table_state"]){
  const stream=createStreamLog();
  const payload={public:{seats:[{userId:"human",profile:{handle:"old-handle",displayName:"Old Name",avatar:{type:"default",variant:"fox-blue"}}}]}};
  const sent=stream.append({tableId:"table",receiverKey:"session",frame:{type,payload}});
  assert.equal(sent.payload.public.seats[0].profile.handle,"old-handle");
  const replay=stream.eventsAfter({tableId:"table",receiverKey:"session",lastSeq:0});
  assert.equal(replay.ok,false);assert.equal(replay.reason,"public_profile_refresh_required");
  assert.equal(JSON.stringify(replay).includes("old-handle"),false);
  assert.deepEqual(stream.eventsAfter({tableId:"table",receiverKey:"session",lastSeq:sent.seq}).frames,[]);
 }
 });

 test("resume refusal forces profile refresh and emits a fresh snapshot while preserving gameplay",async()=>{
 const {createTableManager}=await import("../table/table-manager.mjs");
 const {refreshResumeSnapshot,buildStateSnapshotPayload}=await import("../read-model/state-snapshot.mjs");
 const userId="00000000-0000-4000-8000-000000000301";
 for(const refreshFails of [false,true]){
  const tableId="resume-profile-block";
  const identity={handle:"old-handle-301",displayName:"Old Name",avatar:{type:"default",variant:"fox-blue"}};
  let blocked=false,reads=0;
  const manager=createTableManager({maxSeats:2,publicProfileFreshMs:60_000,publicProfileLoader:async()=>{
   reads++;
   if(blocked && refreshFails)throw new Error("profile_db_unavailable");
   return blocked?{}:{[userId]:identity};
  }});
  manager.restoreTableFromPersisted(tableId,{coreState:{version:42,roomId:tableId,maxSeats:2,
   members:[{userId,seat:1}],seats:{[userId]:1},seatDetailsByUserId:{[userId]:{isBot:false}},
   publicStacks:{[userId]:900},pokerState:null}});
  await manager.refreshPublicProfiles(tableId,{force:true});
  const before=manager.tableSnapshot(tableId,userId);
  assert.deepEqual(before.seats[0].profile,identity);
  const stream=createStreamLog();
  stream.append({tableId,receiverKey:"session",frame:{type:"stateSnapshot",payload:buildStateSnapshotPayload({tableSnapshot:before,userId})}});
  blocked=true;
  const replay=stream.eventsAfter({tableId,receiverKey:"session",lastSeq:0});
  assert.equal(replay.ok,false);assert.equal(replay.reason,"public_profile_refresh_required");
  // Invoke the same resume orchestration used by server.mjs, not a copy of its logic.
  const after=await refreshResumeSnapshot({tableManager:manager,tableId,userId,reason:replay.reason});
  assert.equal(reads,2,"fresh cache must be bypassed after replay refusal");
  const sent=buildStateSnapshotPayload({tableSnapshot:after,userId});
  assert.equal(JSON.stringify(sent).includes(identity.handle),false);
  assert.equal(JSON.stringify(sent).includes(identity.displayName),false);
  assert.equal(JSON.stringify(sent).includes("fox-blue"),false);
  const withoutIdentity=value=>JSON.parse(JSON.stringify(value,(key,item)=>key==="profile"?undefined:item));
  assert.deepEqual(withoutIdentity(after),withoutIdentity(before),"seat, stack, stateVersion and all gameplay data unchanged");
  assert.equal(after.youSeat,1);assert.equal(after.stateVersion,42);assert.equal(after.stacks[userId],900);
 }
 });
