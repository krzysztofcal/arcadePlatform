import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { claimBonusCampaign } from '../netlify/functions/_shared/bonus-campaigns.mjs';
import { createBonusCampaign, setBonusCampaignStatus } from '../netlify/functions/admin-bonus-campaigns.mjs';

const dbUrl = process.env.CHIPS_MIGRATIONS_TEST_DB_URL;
function gate() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('Daily campaign PostgreSQL row lock, ledger replay and receipt rollback', { skip: !dbUrl, timeout: 30000 }, async (t) => {
  const target = new URL(dbUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'requires local disposable PostgreSQL');
  assert.match(target.pathname, /_test$/);
  const sql = postgres(dbUrl, { max: 4 });
  t.after(() => sql.end({ timeout: 1 }));
  const userId = randomUUID();
  await sql`insert into auth.users (id, created_at, is_anonymous) values (${userId}, '2025-01-01', false)`;
  const create = async () => {
    const code = 'daily-test-' + randomUUID();
    const rows = await sql`insert into public.bonus_campaigns
      (code,title,campaign_type,amount,status,starts_at,eligibility_type,eligibility_config,claim_policy,max_total_claims)
      values (${code},'Daily Test','poker_daily',25,'active','2025-01-01','all_accounts',
        '{"daily_rewards":[25,50,100,200]}'::jsonb,'daily',null) returning id`;
    return { id: rows[0].id, code };
  };
  const deps = { executeSql: (q,p) => sql.unsafe(q,p), beginSql: (fn) => sql.begin(fn) };

  const configured = await createBonusCampaign({ code: 'daily-admin-' + randomUUID(), title: 'Daily Admin',
    campaignType: 'poker_daily', amount: 25, startsAt: '2025-01-01T00:00:00Z',
    eligibilityType: 'all_accounts', claimPolicy: 'daily', maxTotalClaims: null,
    eligibilityConfig: { daily_rewards: [25,50,100,200] } }, userId, deps.executeSql);
  assert.deepEqual(configured.eligibilityConfig.daily_rewards, [25,50,100,200]);
  await setBonusCampaignStatus(configured.id, 'active', deps.executeSql, deps.beginSql);

  // Both preflights succeed before either enters its real payout transaction.
  const daily = await create();
  const ready = gate();
  let entrants = 0;
  const concurrent = { ...deps, beginSql: async (fn) => {
    if (++entrants === 2) ready.resolve();
    await ready.promise;
    return sql.begin(fn);
  } };
  const claims = await Promise.all([claimBonusCampaign(userId,daily.code,concurrent), claimBonusCampaign(userId,daily.code,concurrent)]);
  assert.equal(claims.filter((claim) => claim.claimed).length, 1);
  assert.equal(claims.filter((claim) => claim.alreadyClaimed && !claim.claimed).length, 1);
  const evidence = await sql`select bc.metadata, sum(e.amount)::bigint as net, count(e.id)::int as entries
    from public.bonus_claims bc join public.chips_entries e on e.transaction_id=bc.transaction_id
    where bc.campaign_id=${daily.id} group by bc.id`;
  assert.equal(evidence.length, 1);
  assert.equal(Number(evidence[0].net), 0);
  assert.equal(evidence[0].entries, 2);
  assert.equal(evidence[0].metadata.streak_day, 1);

  // End holds the actual campaign row while a claim with successful preflight waits.
  const ending = await create();
  const locked = gate();
  const release = gate();
  const attempting = gate();
  let endTask;
  t.after(() => release.resolve());
  const denied = claimBonusCampaign(userId, ending.code, { ...deps, beginSql: async (fn) => {
    endTask = sql.begin(async (tx) => {
      await tx`update public.bonus_campaigns set status='ended' where id=${ending.id}`;
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    return sql.begin(async (tx) => {
      const [{ pid }] = await tx`select pg_backend_pid() as pid`;
      attempting.resolve(pid);
      return fn(tx);
    });
  } });
  const pid = await attempting.promise;
  const deadline = Date.now() + 10000;
  while (true) {
    const [{ blocked }] = await sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`;
    if (blocked) break;
    assert.ok(Date.now() < deadline, 'claim must wait on End row lock');
    await new Promise((resolve) => setImmediate(resolve));
  }
  release.resolve();
  await endTask;
  assert.equal((await denied).reason, 'campaign_inactive');
  assert.equal((await sql`select id from public.bonus_claims where campaign_id=${ending.id}`).length, 0);

  // The real ledger write must disappear if its receipt cannot be written.
  const failing = await create();
  const [{ balance: before }] = await sql`select balance from public.chips_accounts where user_id=${userId}`;
  await assert.rejects(claimBonusCampaign(userId, failing.code, { ...deps, beginSql: (fn) => sql.begin((tx) => fn(new Proxy(tx, { get(target, key) {
    if (key === "unsafe") return (q,p) => q.includes("insert into public.bonus_claims") ? Promise.resolve([]) : target.unsafe(q,p);
    return Reflect.get(target, key);
  } }))) }), /bonus_claim_write_failed/);
  const [{ balance: after }] = await sql`select balance from public.chips_accounts where user_id=${userId}`;
  assert.equal(after, before);
  assert.equal((await sql`select id from public.chips_transactions where metadata->>'campaign_code'=${failing.code}`).length, 0);
  assert.equal((await sql`select transaction_id from public.chips_transaction_idempotency where idempotency_key like ${'bonus:' + failing.code + ':%'}`).length, 0);
});
