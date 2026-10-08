import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import postgres from 'postgres';
import { PGlite } from '@electric-sql/pglite';
import { executePokerGiftPurchase, loadActiveGiftSummary } from './gift-purchase.mjs';
import { GIFT_CATALOG } from './gift-catalog.mjs';

const tableId = '00000000-0000-4000-8000-000000000001';
const buyerUserId = '00000000-0000-4000-8000-000000000002';
const humanId = '00000000-0000-4000-8000-000000000003';
const botId = '00000000-0000-4000-8000-000000000004';
async function fixture({ funds = 10000, failReceipt = false, ledgerFailure = false, driverTimestampBinding = false } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table poker_tables (id uuid primary key, status text);
    create table poker_seats (table_id uuid, user_id uuid, seat_no int, status text, is_bot boolean, joined_at timestamptz);
    create table test_burns (id uuid default gen_random_uuid(), payload jsonb);
    create table test_balances (balance bigint);
    insert into poker_tables values ('${tableId}', 'OPEN');
    insert into test_balances values (${funds});
    insert into poker_seats values ('${tableId}', '${buyerUserId}', 1, 'ACTIVE', false, '2026-01-01T00:00:00.123456Z'),
      ('${tableId}', '${humanId}', 2, 'ACTIVE', false, '2026-01-01T00:00:00.123456Z'),
      ('${tableId}', '${botId}', 3, 'ACTIVE', true, '2026-01-01T00:00:00.123456Z');`);
  await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261004220956_poker_gift_purchases.sql', import.meta.url), 'utf8'));
  const beginSql = (fn) => db.transaction((sql) => fn({ unsafe: async (q, args = []) => {
    if (failReceipt && q.startsWith('insert into public.poker_gift_purchases')) throw new Error('receipt failed');
    // Model postgres-js inferred timestamp binding, including its actual Date serializer.
    if (driverTimestampBinding && q.startsWith('insert into public.poker_gift_purchases')) {
      const client = postgres();
      args = args.map((value, index) => [4, 7].includes(index) && !q.includes('$' + (index + 1) + '::text')
        ? client.options.serializers[1184](value) : value);
      await client.end();
    }
    return (await sql.query(q, args)).rows;
  } }));
  const postTransaction = async (payload) => {
    assert.equal(payload.txType, 'BURN');
    assert.equal(payload.userId, buyerUserId);
    assert.deepEqual(payload.entries, [{ accountType: 'USER', userId: buyerUserId, amount: -GIFT_CATALOG.find(g => g.giftKey === payload.metadata.giftKey).priceCh }, { accountType: 'SYSTEM', systemKey: 'GENESIS', amount: GIFT_CATALOG.find(g => g.giftKey === payload.metadata.giftKey).priceCh }]);
    assert.equal(payload.entries.reduce((sum, entry) => sum + entry.amount, 0), 0);
    const [balance] = await payload.tx.unsafe('select balance from test_balances');
    if (ledgerFailure || Number(balance.balance) < -payload.entries[0].amount) throw Object.assign(new Error('insufficient_funds'), { code: 'insufficient_funds' });
    await payload.tx.unsafe('update test_balances set balance = balance + $1', [payload.entries[0].amount]);
    const [row] = await payload.tx.unsafe('insert into test_burns(payload) values ($1::jsonb) returning id', [JSON.stringify({ ...payload, tx: undefined })]);
    return { transaction: { id: row.id } };
  };
  const buy = (extra = {}) => executePokerGiftPurchase({ beginSql, postTransaction, tableId, buyerUserId, requestId: 'gift-1', giftKey: 'beer', recipientSeatNo: 2, ...extra });
  return { db, beginSql, buy };
}
for (const recipientSeatNo of [2, 3]) test(`human sends to seat ${recipientSeatNo}: exact BURN, receipt and stable replay`, async () => {
  const f = await fixture();
  try {
    const first = await f.buy({ recipientSeatNo });
    const replay = await f.buy({ recipientSeatNo });
    assert.deepEqual(replay.event, first.event); assert.equal(replay.replayed, true);
    assert.equal((await f.db.query('select * from test_burns')).rows.length, 1);
    const [receipt] = (await f.db.query('select * from poker_gift_purchases')).rows;
    assert.equal(Number(receipt.amount_ch), 25); assert.equal(receipt.payment_source, 'CH');
    assert.equal((await f.db.query("select to_char(recipient_joined_at, 'US') as us from poker_gift_purchases")).rows[0].us, '123456');
    assert.deepEqual(await f.beginSql(tx => loadActiveGiftSummary(tx, tableId)), { seats: [{ seatNo: recipientSeatNo, userId: recipientSeatNo === 2 ? humanId : botId, gifts: [{ giftKey: 'beer', count: 1 }], recentGifts: [{ eventId: first.event.eventId, giftKey: 'beer' }] }] });
    await assert.rejects(f.buy({ giftKey: 'coffee' }), { code: 'gift_idempotency_conflict' });
    await assert.rejects(f.buy({ requestId: 'new' }), { code: 'gift_rate_limited' });
    await f.db.exec("update poker_gift_purchases set created_at = clock_timestamp() - interval '3 seconds'");
    assert.equal((await f.buy({ requestId: 'new' })).ok, true);
  } finally { await f.db.close(); }
});
test('self gift rejects before postTransaction with zero BURN and receipt', async () => {
  const f = await fixture();
  let ledgerCalls = 0;
  try {
    await assert.rejects(f.buy({ recipientSeatNo: 1, postTransaction: () => {
      ledgerCalls += 1;
      assert.fail('self gift must not call postTransaction');
    } }), { code: 'gift_target_unavailable' });
    assert.equal(ledgerCalls, 0);
    assert.equal((await f.db.query('select * from test_burns')).rows.length, 0);
    assert.equal((await f.db.query('select * from poker_gift_purchases')).rows.length, 0);
    assert.equal(Number((await f.db.query('select balance from test_balances')).rows[0].balance), 10000);
  } finally { await f.db.close(); }
});
for (const options of [{ funds: 0 }, { failReceipt: true }, { ledgerFailure: true }]) test(`atomic rollback ${JSON.stringify(options)}`, async () => {
  const f = await fixture(options);
  try { await assert.rejects(f.buy()); assert.equal((await f.db.query('select * from test_burns')).rows.length, 0); assert.equal((await f.db.query('select * from poker_gift_purchases')).rows.length, 0); assert.equal(Number((await f.db.query('select balance from test_balances')).rows[0].balance), options.funds ?? 10000); }
  finally { await f.db.close(); }
});
test('inactive recipient and bot buyer fail; leave/rejoin never restores old participation gifts', async () => {
  const f = await fixture();
  try {
    await f.db.exec('update poker_seats set is_bot = true where seat_no = 1');
    await assert.rejects(f.buy(), { code: 'invalid_sender' });
    await f.db.exec("update poker_seats set is_bot = false where seat_no = 1; update poker_seats set status = 'LEFT' where seat_no = 2");
    await assert.rejects(f.buy(), { code: 'gift_target_unavailable' });
    await f.db.exec("update poker_seats set status = 'ACTIVE' where seat_no = 2"); await f.buy();
    await f.db.exec("update poker_seats set joined_at = joined_at + interval '1 microsecond' where seat_no = 2");
    assert.deepEqual(await f.beginSql(tx => loadActiveGiftSummary(tx, tableId)), { seats: [] });
  } finally { await f.db.close(); }
});
test('receipt schema denies clients, constrains safe CH and preserves receipts after table removal', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.db.query("select relrowsecurity from pg_class where relname = 'poker_gift_purchases'")).rows[0].relrowsecurity, true);
    assert.equal((await f.db.query("select * from pg_policies where tablename = 'poker_gift_purchases'")).rows.length, 0);
    assert.equal((await f.db.query("select indexname from pg_indexes where tablename = 'poker_gift_purchases'")).rows.length, 4);
    await f.buy(); await f.db.exec('delete from poker_tables');
    assert.equal((await f.db.query('select * from poker_gift_purchases')).rows.length, 1);
    await assert.rejects(f.db.exec("update poker_gift_purchases set amount_ch = 9007199254740992"));
    await assert.rejects(f.db.exec("update poker_gift_purchases set payment_source = 'STRIPE'"));
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`set role ${role}`);
      await assert.rejects(f.db.query('select * from poker_gift_purchases'));
      await f.db.exec('reset role');
    }
  } finally { await f.db.close(); }
});

test('invalid IDs/catalog/seat fail before SQL and catalog is exactly V1', async () => {
  assert.deepEqual(GIFT_CATALOG.map(gift => [gift.giftKey, gift.priceCh]), [['coffee',10],['beer',25],['whisky',50],['pizza',100],['cake',250],['diamond',1000]]);
  const base = { tableId, buyerUserId, requestId: 'r1', giftKey: 'beer', recipientSeatNo: 2, beginSql: () => assert.fail('SQL must not run') };
  for (const patch of [{ tableId: 'bad' }, { buyerUserId: 'guest' }, { requestId: '' }, { requestId: 'r'.repeat(129) }, { giftKey: 'fireworks' }, { recipientSeatNo: '2' }, { recipientSeatNo: 0 }]) await assert.rejects(executePokerGiftPurchase({ ...base, ...patch }), { code: 'gift_invalid' });
});


test('receipt recovery returns three latest purchases, duplicates included, for current occupant only', async () => {
  const f = await fixture();
  try {
    const events = [];
    for (const [index, giftKey] of ['beer', 'coffee', 'beer', 'pizza'].entries()) {
      await f.db.exec("update poker_gift_purchases set created_at = created_at - interval '4 seconds'");
      events.unshift((await f.buy({ giftKey, requestId: 'recent-' + index })).event);
    }
    const summary = await f.beginSql(tx => loadActiveGiftSummary(tx, tableId));
    assert.equal(summary.seats[0].userId, humanId);
    assert.deepEqual(summary.seats[0].recentGifts, events.slice(0, 3).map(event => ({ eventId: event.eventId, giftKey: event.giftKey })));
    assert.deepEqual(await f.beginSql(tx => loadActiveGiftSummary(tx, tableId)), summary);
    await f.db.exec("update poker_seats set user_id = '00000000-0000-4000-8000-000000000005' where seat_no = 2");
    assert.deepEqual(await f.beginSql(tx => loadActiveGiftSummary(tx, tableId)), { seats: [] });
  } finally { await f.db.close(); }
});


test('postgres timestamp binding preserves exact receipt participation for recovery', async () => {
  const f = await fixture({ driverTimestampBinding: true });
  try {
    const purchase = await f.buy();
    const rows = await f.db.query(`select g.sender_joined_at = sender.joined_at as same_sender,
      g.recipient_joined_at = recipient.joined_at as same_recipient from poker_gift_purchases g
      join poker_seats sender on sender.seat_no = g.sender_seat_no
      join poker_seats recipient on recipient.seat_no = g.recipient_seat_no`);
    assert.deepEqual(rows.rows, [{ same_sender: true, same_recipient: true }]);
    const summary = await f.beginSql(tx => loadActiveGiftSummary(tx, tableId));
    assert.deepEqual(summary.seats[0].recentGifts, [{ eventId: purchase.event.eventId, giftKey: 'beer' }]);
  } finally { await f.db.close(); }
});
