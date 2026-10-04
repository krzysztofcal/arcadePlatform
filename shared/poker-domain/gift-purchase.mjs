import { createHash } from 'node:crypto';
import { resolveGift } from './gift-catalog.mjs';

function fail(code) { throw Object.assign(new Error(code), { code }); }
function uuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null; }
function result(receipt, replayed) {
  return { ok: true, replayed, event: { eventId: receipt.id, senderSeatNo: Number(receipt.sender_seat_no), recipientSeatNo: Number(receipt.recipient_seat_no), giftKey: receipt.gift_key } };
}

export async function executePokerGiftPurchase({ beginSql, postTransaction, tableId, buyerUserId, requestId, giftKey, recipientSeatNo }) {
  tableId = uuid(tableId);
  buyerUserId = uuid(buyerUserId);
  const gift = resolveGift(giftKey);
  if (!tableId || !buyerUserId || typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128
      || !gift || !Number.isInteger(recipientSeatNo) || recipientSeatNo < 1) fail('gift_invalid');
  const purchaseKey = 'poker-gift:' + createHash('sha256').update(JSON.stringify([tableId, buyerUserId, requestId])).digest('hex');
  return beginSql(async (tx) => {
    await tx.unsafe('select pg_advisory_xact_lock(hashtextextended($1, 0));', ['poker-gift:' + tableId + ':' + buyerUserId]);
    const [existing] = await tx.unsafe('select * from public.poker_gift_purchases where purchase_key = $1;', [purchaseKey]);
    if (existing) {
      if (existing.table_id !== tableId || existing.buyer_user_id !== buyerUserId || existing.gift_key !== giftKey
          || Number(existing.recipient_seat_no) !== recipientSeatNo) fail('gift_idempotency_conflict');
      return result(existing, true);
    }
    // Read wall time AFTER acquiring the buyer lock (transaction now() predates waiting).
    const [limited] = await tx.unsafe(`select id from public.poker_gift_purchases
      where table_id = $1 and buyer_user_id = $2 and created_at > clock_timestamp() - interval '3 seconds'
      order by created_at desc limit 1;`, [tableId, buyerUserId]);
    if (limited) fail('gift_rate_limited');
    // SHARE protects lifecycle without mutating/locking poker_state. Seats are locked in seat order.
    const [table] = await tx.unsafe('select id, status from public.poker_tables where id = $1 for share nowait;', [tableId]);
    if (!table || table.status !== 'OPEN') fail('gift_shop_unavailable');
    const seats = await tx.unsafe(`select user_id, seat_no, status, is_bot, joined_at,
      to_char(joined_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as participation
      from public.poker_seats where table_id = $1 and (user_id = $2 or seat_no = $3)
      order by seat_no for update nowait;`, [tableId, buyerUserId, recipientSeatNo]);
    const sender = seats.find((seat) => seat.user_id === buyerUserId && seat.status === 'ACTIVE');
    if (!sender) fail('not_seated');
    if (sender.is_bot !== false) fail('invalid_sender');
    const recipient = seats.find((seat) => Number(seat.seat_no) === recipientSeatNo && seat.status === 'ACTIVE');
    if (!recipient) fail('gift_target_unavailable');
    // SQL-formatted participation preserves Postgres microseconds; JS Date would truncate them.
    if (!sender.participation || !recipient.participation) fail('gift_purchase_failed');
    const ledger = await postTransaction({ tx, txType: 'BURN', userId: buyerUserId, createdBy: buyerUserId,
      idempotencyKey: purchaseKey,
      metadata: { purpose: 'poker_gift', tableId, giftKey, recipientSeatNo, recipientUserId: recipient.user_id, amountCh: gift.priceCh },
      entries: [{ accountType: 'USER', userId: buyerUserId, amount: -gift.priceCh },
        { accountType: 'SYSTEM', systemKey: 'GENESIS', amount: gift.priceCh }] });
    if (!ledger?.transaction?.id) fail('gift_purchase_failed');
    const [receipt] = await tx.unsafe(`insert into public.poker_gift_purchases
      (purchase_key, payment_source, payment_reference, buyer_user_id, sender_seat_no, sender_joined_at,
       recipient_user_id, recipient_seat_no, recipient_joined_at, table_id, gift_key, amount_ch, created_at)
      values ($1, 'CH', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clock_timestamp()) returning *;`,
      [purchaseKey, String(ledger.transaction.id), buyerUserId, sender.seat_no, sender.participation,
        recipient.user_id, recipientSeatNo, recipient.participation, tableId, giftKey, gift.priceCh]);
    if (!receipt) fail('gift_purchase_failed');
    return result(receipt, false);
  });
}

export async function loadActiveGiftSummary(tx, tableId) {
  const rows = await tx.unsafe(`select s.seat_no, g.gift_key, count(*)::int as count
    from public.poker_seats s join public.poker_gift_purchases g
      on g.table_id = s.table_id and g.recipient_user_id = s.user_id
      and g.recipient_seat_no = s.seat_no and g.recipient_joined_at = s.joined_at
    where s.table_id = $1 and s.status = 'ACTIVE'
    group by s.seat_no, g.gift_key order by s.seat_no, g.gift_key;`, [tableId]);
  const seats = [];
  for (const row of rows) {
    let seat = seats.find((item) => item.seatNo === Number(row.seat_no));
    if (!seat) { seat = { seatNo: Number(row.seat_no), gifts: [] }; seats.push(seat); }
    seat.gifts.push({ giftKey: row.gift_key, count: Number(row.count) });
  }
  return { seats };
}
