import assert from "node:assert/strict";
import test from "node:test";

const {
  ensureUserProfile,
  ownerProfile,
  publicProfile,
  updateUserProfile,
} = await import("../netlify/functions/_shared/user-profile.mjs");
const { computeXpLevel } = await import("../netlify/functions/_shared/xp-level.mjs");
const { createProfileMeHandler } = await import("../netlify/functions/profile-me.mjs");
const { createProfilePublicHandler, publicProfilesEnabled } = await import("../netlify/functions/profile-public.mjs");
const { projectPublicAvatar } = await import("../shared/profile-avatar-projection.mjs");
const { normalizePublicPokerIdentity, projectPublicPokerIdentity } = await import("../ws-server/poker/read-model/public-poker-identity.mjs");

const USER_ID = "00000000-0000-4000-8000-000000000003";

function event(method, body = null, query = {}) {
  return {
    httpMethod: method,
    headers: { origin: "https://arcade.test", authorization: "Bearer token" },
    body: body == null ? null : JSON.stringify(body),
    queryStringParameters: query,
  };
}

function profile(overrides = {}) {
  return {
    userId: USER_ID,
    handle: "blue-fox-482731",
    displayName: "Blue Fox 482731",
    avatarKey: "internal/private-key.webp",
    avatarVariant: "fox-blue",
    handleCustomizedAt: null,
    leaderboardVisible: true,
    ...overrides,
  };
}

function dbProfile(overrides = {}) {
  const value = profile(overrides);
  return {
    user_id: value.userId,
    handle: value.handle,
    display_name: value.displayName,
    bio: value.bio,
    avatar_key: value.avatarKey,
    avatar_variant: value.avatarVariant,
    handle_customized_at: value.handleCustomizedAt,
    leaderboard_visible: value.leaderboardVisible,
  };
}

function transactionForProfile(row, updateError = null) {
  return async (callback) => callback({
    unsafe: async (query, params) => {
      if (query === "select pg_advisory_xact_lock(hashtextextended($1, 0));"){
        assert.deepEqual(params, ["account-lifecycle:" + row.user_id]);
        return [];
      }
      if (query.includes("insert into public.user_profiles")) return [row];
      if (query.includes("for update")) return [row];
      if (query.includes("update public.user_profiles")) {
        if (updateError) throw updateError;
        return [row];
      }
      throw new Error("unexpected_query");
    },
  });
}

test("profile helper delegates idempotent creation to the database function", async () => {
  let called = null;
  const result = await ensureUserProfile(USER_ID, {
    executeSql: async (query, params) => { called = { query, params }; return [dbProfile()]; },
  });
  assert.match(called.query, /from public\.ensure_user_profile\(\$1::uuid\)/);
  assert.deepEqual(called.params, [USER_ID]);
  assert.equal(result.leaderboardVisible, true);
});

test("public projection never returns internal identity or avatar storage key", () => {
  const projected = publicProfile(profile());
  assert.deepEqual(projected, {
    handle: "blue-fox-482731",
    displayName: "Blue Fox 482731",
    avatar: { type: "default", variant: "fox-blue" },
  });
  assert.equal("userId" in projected, false);
  assert.equal(JSON.stringify(projected).includes("internal/private-key.webp"), false);
  assert.equal("leaderboardVisible" in projected, false);
});

test("owner projection exposes leaderboard visibility without leaking it publicly", () => {
  const owner = ownerProfile(profile({ leaderboardVisible: false }));
  assert.equal(owner.leaderboardVisible, false);
  assert.equal("leaderboardVisible" in publicProfile(profile({ leaderboardVisible: false })), false);
});

test("phase A projects a catalog avatar even when a legacy upload exists", () => {
  assert.deepEqual(publicProfile(profile({avatarKey:"10000000-0000-4000-8000-000000000001.webp"})).avatar,{type:"default",variant:"fox-blue"});
});

test("public projection exposes only current XP and computed level", () => {
  const projected = publicProfile(profile(), { xp: 235, level: computeXpLevel(235) });
  assert.equal(projected.xp, 235);
  assert.equal(projected.level, 3);
  assert.equal("userId" in projected, false);
  assert.equal("avatarKey" in projected, false);
});

test("poker identity shares avatar rules without inheriting full public profile fields", () => {
  const avatar = projectPublicAvatar({
    avatarKey: "10000000-0000-4000-8000-000000000001.webp",
    avatarVariant: "fox-blue",
    storageBaseUrl: "https://stageabc.supabase.co"
  });
  const projected = projectPublicPokerIdentity({
    public_profile_blocked: false,
    handle: "blue-fox-482731",
    display_name: "Blue Fox 482731",
    bio: "public but not a poker field",
    xp: 900,
    avatar_key: "10000000-0000-4000-8000-000000000001.webp",
    avatar_variant: "fox-blue"
  }, { storageBaseUrl: "https://stageabc.supabase.co" });

  assert.deepEqual(projected, {
    handle: "blue-fox-482731",
    displayName: "Blue Fox 482731",
    avatar
  });
  assert.equal("bio" in projected, false);
  assert.equal("xp" in projected, false);
  assert.equal("avatarKey" in projected, false);
});

test("poker identity accepts uploaded avatars only from the configured Arcade Hub Storage origin", () => {
  const identity = {
    handle: "blue-fox-482731",
    displayName: "Blue Fox 482731",
    avatar: {
      type: "uploaded",
      url: "https://arcadehub.supabase.co/storage/v1/object/public/profile-avatars/10000000-0000-4000-8000-000000000001.webp"
    }
  };

  assert.deepEqual(normalizePublicPokerIdentity(identity, {
    storageBaseUrl: "https://arcadehub.supabase.co"
  }), identity);
  assert.equal(normalizePublicPokerIdentity(identity, {
    storageBaseUrl: "https://foreign-project.supabase.co"
  }), null);
  assert.equal(normalizePublicPokerIdentity(identity), null);
});

test("shared avatar projection falls back for unknown variants and untrusted storage origins", () => {
  assert.deepEqual(projectPublicAvatar({ avatarVariant: "unknown" }), { type: "default", variant: "default" });
  assert.deepEqual(projectPublicPokerIdentity({
    public_profile_blocked: false,
    handle: "default-avatar-101",
    display_name: "Default Avatar 101",
    avatar_variant: "unknown"
  }), {
    handle: "default-avatar-101",
    displayName: "Default Avatar 101",
    avatar: { type: "default", variant: "default" }
  });
  assert.deepEqual(projectPublicAvatar({
    avatarKey: "10000000-0000-4000-8000-000000000001.webp",
    avatarVariant: "orbit-green",
    storageBaseUrl: "https://images.example.com"
  }), { type: "default", variant: "orbit-green" });
});

test("server XP level boundaries match the client progression", () => {
  assert.equal(computeXpLevel(0), 1);
  assert.equal(computeXpLevel(99), 1);
  assert.equal(computeXpLevel(100), 2);
  assert.equal(computeXpLevel(234), 2);
  assert.equal(computeXpLevel(235), 3);
});

test("profile-me rejects empty and unknown PATCH fields", async () => {
  const handler = createProfileMeHandler({
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    ensureUserProfile: async () => profile(),
  });
  for (const payload of [{}, { displayNmae: "Typo" }]) {
    const response = await handler(event("PATCH", payload));
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: "invalid_request" });
  }
});

test("profile-me rejects non-boolean leaderboard visibility", async () => {
  const handler = createProfileMeHandler({
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    updateUserProfile: async () => { const error = new Error("invalid_leaderboard_visibility"); error.code = "invalid_leaderboard_visibility"; error.status = 400; throw error; },
  });
  const response = await handler(event("PATCH", { leaderboardVisible: "false" }));
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_leaderboard_visibility" });
});

test("profile helper rejects non-boolean leaderboard visibility before a database write", async () => {
  let writes = 0;
  await assert.rejects(
    () => updateUserProfile(USER_ID, { leaderboardVisible: "false" }, {
      executeSql: async () => [dbProfile()],
      beginSql: async () => { writes += 1; },
    }),
    { code: "invalid_leaderboard_visibility", status: 400 },
  );
  assert.equal(writes, 0);
});

test("profile-me rejects all former manual identity fields before invoking persistence", async () => {
 const handler=createProfileMeHandler({verifySupabaseJwt:async()=>({valid:true,userId:USER_ID}),updateUserProfile:async()=>{throw Error("must not write");}});
 for(const payload of [{handle:"custom-player"},{displayName:"Manual"},{bio:"Text"}])assert.equal((await handler(event("PATCH",payload))).statusCode,400);
});

test("profile-me includePoker returns the full authoritative table projection and balance", async () => {
  const tableId = "table-full-runtime-identifier-4f2a";
  const calls = [];
  const handler = createProfileMeHandler({
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    ensureUserProfile: async () => profile(),
    getUserBalance: async (userId) => {
      calls.push(["balance", userId]);
      return { balance: 735 };
    },
    loadPokerProjection: async (userId) => {
      calls.push(["poker", userId]);
      return {
        inPoker: true,
        tables: [{ tableId, status: "OPEN", seatNo: 2, seatStatus: "ACTIVE", stack: 980, stakes: { sb: 5, bb: 10 }, maxPlayers: 6, stateVersion: 42, handStatus: "FLOP", leaving: true }]
      };
    }
  });

  const response = await handler(event("GET", null, { includePoker: "1" }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.balance, 735);
  assert.equal(body.poker.inPoker, true);
  assert.equal(body.poker.tables[0].tableId, tableId);
  assert.equal(body.poker.tables[0].leaving, true);
  assert.deepEqual(calls, [["balance", USER_ID], ["poker", USER_ID]]);
});

test("profile-me keeps the correct balance when authoritative poker projection is unavailable", async () => {
  const handler = createProfileMeHandler({
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    ensureUserProfile: async () => profile(),
    getUserBalance: async () => ({ balance: 735 }),
    loadPokerProjection: async () => { throw new Error("ws_projection_unavailable"); }
  });

  const response = await handler(event("GET", null, { includePoker: "1" }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.balance, 735);
  assert.notEqual(body.balance, 0);
  assert.equal(body.poker, null);
});

test("profile-me preserves wallet when the public WS proxy returns a successful non-JSON response", async () => {
  const logs = [];
  const handler = createProfileMeHandler({
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    ensureUserProfile: async () => profile(),
    getUserBalance: async () => ({ balance: 708 }),
    env: { POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.example", POKER_WS_INTERNAL_TOKEN: "test-token" },
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).pathname, "/internal/account/poker");
      assert.equal(new URL(url).searchParams.get("userId"), USER_ID);
      assert.equal(options.headers.authorization, "Bearer test-token");
      return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
    },
    klog: (kind, data) => logs.push({ kind, data })
  });
  const response = await handler(event("GET", null, { includePoker: "1" }));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.balance, 708);
  assert.equal(body.poker, null);
  assert.ok(logs.some(log => log.data.reason === "invalid_json"));
});

test("manual identity updates are rejected regardless of historical handle state", async () => {
 for(const payload of [{handle:"second-handle"},{displayName:"Manual"},{bio:"Text"}])await assert.rejects(updateUserProfile(USER_ID,payload),{code:"profile_field_read_only"});
});

test("leaderboard opt-out synchronizes Redis before the database write", async () => {
  const updatedRow = dbProfile({ leaderboardVisible: false });
  const effects = [];
  const result = await updateUserProfile(USER_ID, { leaderboardVisible: false }, {
    executeSql: async () => [dbProfile()],
    beginSql: async (callback) => { effects.push("db"); return transactionForProfile(updatedRow)(callback); },
    syncLeaderboardVisibility: async (userId, visible) => { effects.push("redis"); assert.deepEqual({ userId, visible }, { userId: USER_ID, visible: false }); },
  });
  assert.equal(result.leaderboardVisible, false);
  assert.deepEqual(effects, ["redis", "db"]);
});

test("leaderboard opt-out leaves the database visible when Redis synchronization fails", async () => {
  let databaseWrites = 0;
  await assert.rejects(
    () => updateUserProfile(USER_ID, { leaderboardVisible: false }, {
      executeSql: async () => [dbProfile()],
      beginSql: async () => { databaseWrites += 1; },
      syncLeaderboardVisibility: async () => { throw new Error("redis_unavailable"); },
    }),
    /redis_unavailable/,
  );
  assert.equal(databaseWrites, 0);
});

test("leaderboard opt-in commits the database before Redis and an identical retry repairs projections", async () => {
  const effects = [];
  const deps = {
    executeSql: async () => [dbProfile({ leaderboardVisible: true })],
    beginSql: async (callback) => { effects.push("db"); return transactionForProfile(dbProfile({ leaderboardVisible: true }))(callback); },
    syncLeaderboardVisibility: async () => { effects.push("redis"); throw new Error("redis_unavailable"); },
  };
  await assert.rejects(() => updateUserProfile(USER_ID, { leaderboardVisible: true }, deps), /redis_unavailable/);
  assert.deepEqual(effects, ["db", "redis"]);

  effects.length = 0;
  deps.syncLeaderboardVisibility = async (userId, visible) => { effects.push("redis"); assert.deepEqual({ userId, visible }, { userId: USER_ID, visible: true }); };
  const repaired = await updateUserProfile(USER_ID, { leaderboardVisible: true }, deps);
  assert.equal(repaired.leaderboardVisible, true);
  assert.deepEqual(effects, ["db", "redis"]);
});

test("profile-public is disabled by default and uses generic not found responses", async () => {
  let reads = 0;
  const disabled = createProfilePublicHandler({verifySupabaseJwt:async()=>({valid:true,userId:USER_ID}),
    env: { PUBLIC_PROFILES_ENABLED: "0" },
    findPublicProfile: async () => { reads += 1; return profile(); },
    allowPublicRead: async () => true,
  });
  const disabledResponse = await disabled(event("GET", null, { handle: "blue-fox-482731" }));
  assert.equal(disabledResponse.statusCode, 404);
  assert.deepEqual(JSON.parse(disabledResponse.body), { error: "not_found" });
  assert.equal(reads, 0);

  const enabled = createProfilePublicHandler({verifySupabaseJwt:async()=>({valid:true,userId:USER_ID}),
    env: { PUBLIC_PROFILES_ENABLED: "1" },
    findPublicProfile: async () => null,
    allowPublicRead: async () => true,
  });
  const unknown = await enabled(event("GET", null, { handle: "unknown-player" }));
  const invalid = await enabled(event("GET", null, { handle: "not valid" }));
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(JSON.parse(unknown.body), JSON.parse(invalid.body));
});

test("profile-public returns current XP and level without internal fields", async () => {
  const handler = createProfilePublicHandler({verifySupabaseJwt:async()=>({valid:true,userId:USER_ID}),
    env: { PUBLIC_PROFILES_ENABLED: "1" },
    findPublicProfile: async () => profile(),
    getUserXpTotal: async (userId) => {
      assert.equal(userId, USER_ID);
      return 235;
    },
    allowPublicRead: async () => true,
  });
  const response = await handler(event("GET", null, { handle: "blue-fox-482731" }));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(body, {
    handle: "blue-fox-482731",
    displayName: "Blue Fox 482731",
    avatar: { type: "default", variant: "fox-blue" },
    xp: 235,
    level: 3,
  });
  assert.equal("userId" in body, false);
  assert.equal("email" in body, false);
  assert.equal("avatarKey" in body, false);
  assert.equal("totalXp" in body, false);
});

test("profile-public fails closed when the XP store read fails", async () => {
  const handler = createProfilePublicHandler({verifySupabaseJwt:async()=>({valid:true,userId:USER_ID}),
    env: { PUBLIC_PROFILES_ENABLED: "1" },
    findPublicProfile: async () => profile(),
    getUserXpTotal: async () => { throw new Error("upstash_unavailable"); },
    allowPublicRead: async () => true,
  });
  const response = await handler(event("GET", null, { handle: "blue-fox-482731" }));
  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), { error: "server_error" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.includes('"xp"'), false);
});

test("profile-public enables deploy previews when the function scope lacks the flag", () => {
  assert.equal(publicProfilesEnabled({ CONTEXT: "deploy-preview" }), true);
  assert.equal(publicProfilesEnabled({ CONTEXT: "deploy-preview", PUBLIC_PROFILES_ENABLED: "0" }), false);
  assert.equal(publicProfilesEnabled({ CONTEXT: "production" }), false);
  assert.equal(publicProfilesEnabled({}, { headers: { host: "deploy-preview-677--playkcswh.netlify.app" } }), true);
  assert.equal(publicProfilesEnabled({}, { headers: { host: "play.kcswh.pl" } }), false);
});

 test("blocked public identities are absent while owner projection remains available", async () => {
 const blocked = profile({publicProfileBlocked:true});
 assert.equal(publicProfile(blocked),null);
 assert.equal(ownerProfile(blocked).handle,blocked.handle);
 assert.equal(projectPublicPokerIdentity({public_profile_blocked:true,handle:blocked.handle,display_name:blocked.displayName,avatar_variant:"fox-blue"}),null);
 assert.equal(projectPublicPokerIdentity({handle:blocked.handle,display_name:blocked.displayName,avatar_variant:"fox-blue"}),null);
 const handler=createProfilePublicHandler({env:{PUBLIC_PROFILES_ENABLED:"1"},verifySupabaseJwt:async()=>({valid:true,userId:USER_ID}),findPublicProfile:async()=>blocked,allowPublicRead:async()=>true});
 const response=await handler(event("GET",null,{handle:blocked.handle}));
 assert.equal(response.statusCode,404);
 assert.equal(response.headers["cache-control"],"no-store");
 assert.equal(JSON.stringify(response).includes(blocked.handle),false);
 });

test('public profile block migration: disposable PostgreSQL17, default, operator guard and unblock', {skip:!process.env.PROFILE_BLOCK_TEST_DB_URL}, async()=>{
 const {readFile}=await import('node:fs/promises');
 const {default:postgres}=await import('postgres');
 const url=new URL(process.env.PROFILE_BLOCK_TEST_DB_URL);
 assert.equal(url.hostname,'127.0.0.1'); assert.match(url.pathname,/_test$/);
 const sql=postgres(url.href,{max:1,prepare:false});
 try {
  assert.match((await sql`show server_version`)[0].server_version,/^17\./);
  assert.equal((await sql`select count(*)::int n from pg_tables where schemaname='public'`)[0].n,0);
  await sql.unsafe(`create schema private; create table public.user_profiles(user_id uuid primary key,avatar_variant text,avatar_revision int,leaderboard_visible boolean,protected jsonb);
   insert into public.user_profiles values ('${USER_ID}','fox-blue',7,true,'{"CH":100,"XP":20,"poker":"unchanged"}');`);
  await sql.unsafe(await readFile(new URL('../supabase/migrations/20261028180000_public_profile_block.sql',import.meta.url),'utf8'));
  const before=(await sql`select * from user_profiles`)[0];assert.equal(before.public_profile_blocked,false);
  // Reuse an existing unprivileged role or create one only inside this disposable cluster.
  await sql.unsafe(`do $$begin if not exists(select 1 from pg_roles where rolname='profile_block_test_user') then create role profile_block_test_user; end if; end$$;
   grant usage on schema public to profile_block_test_user;grant select,insert,update on public.user_profiles to profile_block_test_user;`);
  await sql.unsafe('set role profile_block_test_user');
  await assert.rejects(sql`update user_profiles set public_profile_blocked=true`,e=>e.code==='42501');
  await sql.unsafe('reset role');
  await sql`update user_profiles set public_profile_blocked=true`;
  assert.equal((await sql`select * from user_profiles where not public_profile_blocked`).length,0);
  await sql`update user_profiles set public_profile_blocked=true`;
  await sql`update user_profiles set public_profile_blocked=false`;
  assert.deepEqual((await sql`select * from user_profiles`)[0],before);
  await sql.unsafe('alter table user_profiles drop column public_profile_blocked');
  await assert.rejects(sql`select * from user_profiles where not public_profile_blocked`,e=>e.code==='42703');
 }finally{await sql.end();}
});

 test("profile-me keeps complete owner access for a publicly blocked account",async()=>{
 const blocked=profile({publicProfileBlocked:true,avatarRevision:9,leaderboardVisible:false});
 const expected=ownerProfile(profile({avatarRevision:9,leaderboardVisible:false}));
 const handler=createProfileMeHandler({
  verifySupabaseJwt:async()=>({valid:true,userId:USER_ID}),
  ensureUserProfile:async(id)=>{assert.equal(id,USER_ID);return blocked;},
  updateUserProfile:async(id)=>{assert.equal(id,USER_ID);return blocked;},
  getUserBalance:async()=>({balance:735}),loadPokerProjection:async()=>null
 });
 for(const request of [event("GET"),event("PATCH",{avatarVariant:"fox-blue",expectedRevision:9})]){
  const response=await handler(request);assert.equal(response.statusCode,200);
  assert.deepEqual(JSON.parse(response.body),expected);
 }
 const response=await handler(event("GET",null,{includePoker:"1"}));
 assert.equal(response.statusCode,200);
 assert.deepEqual(JSON.parse(response.body),{...expected,balance:735,poker:null});
 assert.equal(publicProfile(blocked),null);
 });

 test("findPublicProfile retains the block flag as defense in depth without restricting owner projection",async()=>{
 const {findPublicProfile}=await import("../netlify/functions/_shared/user-profile.mjs");
 for(const blocked of [false,true]){
  const result=await findPublicProfile("fox-123",async(query)=>{
   assert.match(query,/select[^;]*leaderboard_visible, public_profile_blocked/);
   assert.match(query,/and public_profile_blocked = false/);
   // Deliberately return a blocked row to test projection independently of the SQL filter.
   return [{user_id:USER_ID,handle:"fox-123",display_name:"Fox",avatar_variant:"fox-blue",avatar_revision:7,leaderboard_visible:false,public_profile_blocked:blocked}];
  });
  assert.equal(result.publicProfileBlocked,blocked);
  assert.equal(publicProfile(result)===null,blocked);
  assert.equal(ownerProfile(result).handle,"fox-123");
  assert.equal(ownerProfile(result).avatarRevision,7);
  assert.equal(ownerProfile(result).leaderboardVisible,false);
 }
 });


test("profile-public requires a verified viewer before any profile, XP or rate read", async () => {
 for(const token of ["", "invalid", "expired", "wrong-project"]){
  let reads=0;
  const handler=createProfilePublicHandler({env:{PUBLIC_PROFILES_ENABLED:"1"},verifySupabaseJwt:async()=>({valid:false}),findPublicProfile:async()=>{reads++;return profile();},allowPublicRead:async()=>{reads++;return true;},getUserXpTotal:async()=>{reads++;return 10;}});
  const request=event("GET",null,{handle:profile().handle});request.headers.authorization=token?"Bearer "+token:"";
  const response=await handler(request);assert.equal(response.statusCode,401);assert.deepEqual(JSON.parse(response.body),{error:"unauthorized"});assert.equal(response.headers["cache-control"],"no-store");assert.equal(reads,0);
 }
});

test("profile-public OPTIONS stays unauthenticated and verifier errors fail closed", async()=>{
 let calls=0;const handler=createProfilePublicHandler({env:{PUBLIC_PROFILES_ENABLED:"1"},verifySupabaseJwt:async()=>{calls++;throw Error("private verifier detail");},findPublicProfile:async()=>{throw Error("must not read");}});
 const options=await handler(event("OPTIONS"));assert.equal(options.statusCode,204);assert.equal(calls,0);
 const response=await handler(event("GET"));assert.equal(response.statusCode,500);assert.equal(calls,1);assert.equal(response.headers["cache-control"],"no-store");assert.equal(response.body.includes("private verifier detail"),false);
});
