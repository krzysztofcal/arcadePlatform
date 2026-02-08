import assert from "node:assert/strict";
import {
  loadConfig,
  getBalance,
  postTx,
  getLedger,
  uniqueKey,
  formatResponse,
} from "./helpers.mjs";

const config = loadConfig();
if (config.missing) {
  const missingList = config.missing.join(", ");
  console.log(`Chips integration tests missing env vars: ${missingList}`);
  if (process.env.CHIPS_TEST_OPTIONAL === "1") {
    console.log("CHIPS_TEST_OPTIONAL=1 is set — skipping chips integration tests.");
    process.exit(0);
  }
  console.log("To skip locally, set CHIPS_TEST_OPTIONAL=1.");
  process.exit(1);
}

function ensureInteger(value, label) {
  assert.ok(Number.isInteger(value), `${label} must be integer`);
}

function isValidDateString(value) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

async function verifyBalanceStructure() {
  const { status, body } = await getBalance(config);
  assert.equal(status, 200, `balance endpoint should succeed; ${formatResponse({ status, body })}`);
  assert.ok(body.accountId, "accountId present");
  ensureInteger(body.balance, "balance");
  ensureInteger(body.nextEntrySeq, "nextEntrySeq");
  return body.balance;
}

async function runBuyIn(amount, key) {
  const { status, body } = await postTx(config, { txType: "BUY_IN", amount, idempotencyKey: key });
  assert.equal(status, 200, `buy-in should succeed; ${formatResponse({ status, body })}`);
  assert.ok(Array.isArray(body.entries), "buy-in response entries must be an array");
  if (body.entries.length) {
    assert.equal(typeof body.entries[0].metadata, "object", "entry metadata must be object when present");
  }
  ensureInteger(body.account?.balance ?? 0, "account.balance");
  return body;
}

async function runCashOut(amount, key) {
  const { status, body } = await postTx(config, { txType: "CASH_OUT", amount, idempotencyKey: key });
  assert.equal(status, 200, `cash-out should succeed; ${formatResponse({ status, body })}`);
  return body;
}

async function runInsufficient(amount) {
  const { status, body } = await postTx(config, { txType: "CASH_OUT", amount, idempotencyKey: uniqueKey("insufficient") });
  assert.equal(status, 400, `insufficient funds should return 400; ${formatResponse({ status, body })}`);
  assert.equal(body.error, "insufficient_funds");
}

async function runIdempotentReplay(amount) {
  const key = uniqueKey("idem");
  const first = await postTx(config, { txType: "BUY_IN", amount, idempotencyKey: key });
  assert.equal(first.status, 200, `initial idempotent call should succeed; ${formatResponse(first)}`);
  const second = await postTx(config, { txType: "BUY_IN", amount, idempotencyKey: key });
  assert.equal(second.status, 200, `idempotent replay should return 200; ${formatResponse(second)}`);
  assert.equal(first.body?.transaction?.id, second.body?.transaction?.id, "idempotent replay must reuse transaction");
  return first.body?.transaction?.id;
}

async function runIdempotencyConflict() {
  const key = uniqueKey("idem-conflict");
  const first = await postTx(config, { txType: "BUY_IN", amount: 22, idempotencyKey: key });
  assert.equal(first.status, 200, `initial conflict setup should succeed; ${formatResponse(first)}`);
  const second = await postTx(config, { txType: "BUY_IN", amount: 23, idempotencyKey: key });
  assert.equal(second.status, 409, `conflicting payload should return 409; ${formatResponse(second)}`);
  assert.equal(second.body?.error, "idempotency_conflict");
}

async function verifyLedgerCursor() {
  const first = await getLedger(config, { limit: 20 });
  assert.equal(first.status, 200, `ledger should succeed; ${formatResponse(first)}`);
  const entries = Array.isArray(first.body?.items) ? first.body.items : [];
  if (!entries.length) return;
  const entriesWithDisplay = entries.filter(entry => entry.display_created_at != null);
  assert.ok(entriesWithDisplay.length > 0, "ledger entries should include display_created_at");
  assert.ok(
    entriesWithDisplay.some(entry => isValidDateString(entry.display_created_at)),
    "ledger display_created_at should be parseable",
  );
  const nextCursor = first.body?.nextCursor;
  assert.ok(nextCursor, `nextCursor must be returned; ${formatResponse(first)}`);
  const next = await getLedger(config, { cursor: nextCursor, limit: 20 });
  assert.equal(next.status, 200, `paged ledger should succeed; ${formatResponse(next)}`);
  const nextEntries = Array.isArray(next.body?.items) ? next.body.items : [];
  if (nextEntries.length) {
    assert.notEqual(
      nextEntries[0].entry_seq,
      entries[entries.length - 1].entry_seq,
      "paged entries must advance cursor",
    );
  }

  if (entries.length && entries[entries.length - 1].entry_seq) {
    const legacy = await getLedger(config, { after: entries[entries.length - 1].entry_seq, limit: 20 });
    assert.equal(legacy.status, 200, `legacy ledger should succeed; ${formatResponse(legacy)}`);
    assert.ok(typeof legacy.body?.sequenceOk === "boolean", `legacy sequenceOk must be boolean; ${formatResponse(legacy)}`);
    assert.ok(
      typeof legacy.body?.nextExpectedSeq === "number",
      `legacy nextExpectedSeq must be number; ${formatResponse(legacy)}`,
    );
    const legacyEntries = Array.isArray(legacy.body?.entries) ? legacy.body.entries : [];
    if (legacyEntries.length) {
      const legacyWithDisplay = legacyEntries.filter(entry => entry.display_created_at != null);
      assert.ok(legacyWithDisplay.length > 0, "legacy ledger entries should include display_created_at");
      assert.ok(
        legacyWithDisplay.some(entry => isValidDateString(entry.display_created_at)),
        "legacy display_created_at should be parseable",
      );
    }
  }
}

async function ensureFunds(minBalance) {
  const current = await getBalance(config);
  assert.equal(current.status, 200, `balance fetch should succeed; ${formatResponse(current)}`);
  if (current.body.balance >= minBalance) {
    return current.body.balance;
  }
  const needed = minBalance - current.body.balance;
  await runBuyIn(needed, uniqueKey("ensure"));
  const updated = await getBalance(config);
  assert.equal(updated.status, 200, `post-top-up balance fetch should succeed; ${formatResponse(updated)}`);
  return updated.body.balance;
}

async function main() {
  const startingBalance = await verifyBalanceStructure();

  const buyKey = uniqueKey("buy");
  await runBuyIn(100, buyKey);
  const afterBuy = await getBalance(config);
  assert.equal(afterBuy.status, 200, `balance after buy-in should succeed; ${formatResponse(afterBuy)}`);
  assert.equal(afterBuy.body.balance, startingBalance + 100, "buy-in should increase balance by amount");

  await ensureFunds(50);
  const cashKey = uniqueKey("cash");
  const beforeCash = await getBalance(config);
  await runCashOut(40, cashKey);
  const afterCash = await getBalance(config);
  assert.equal(afterCash.status, 200, `balance after cash-out should succeed; ${formatResponse(afterCash)}`);
  assert.equal(afterCash.body.balance, beforeCash.body.balance - 40, "cash-out should reduce balance");

  const snapshotBefore = await getBalance(config);
  assert.equal(snapshotBefore.status, 200, `snapshot balance fetch should succeed; ${formatResponse(snapshotBefore)}`);
  const attemptAmount = snapshotBefore.body.balance + 1;
  await runInsufficient(attemptAmount);
  const afterFail = await getBalance(config);
  assert.equal(afterFail.status, 200, `post-insufficient balance fetch should succeed; ${formatResponse(afterFail)}`);
  assert.equal(afterFail.body.balance, snapshotBefore.body.balance, "insufficient attempt must not change balance");

  const replayStart = await getBalance(config);
  assert.equal(replayStart.status, 200, `pre-replay balance fetch should succeed; ${formatResponse(replayStart)}`);
  await runIdempotentReplay(33);
  const replayEnd = await getBalance(config);
  assert.equal(replayEnd.status, 200, `post-replay balance fetch should succeed; ${formatResponse(replayEnd)}`);
  assert.equal(replayEnd.body.balance, replayStart.body.balance + 33, "idempotent replay applies once");

  await runIdempotencyConflict();

  await verifyLedgerCursor();

  console.log("Chips integration tests passed");
}

main().catch((error) => {
  console.error("Chips integration tests failed", error);
  process.exit(1);
});
