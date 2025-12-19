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
  const message = `Chips integration tests missing env vars: ${config.missing.join(", ")}`;
  console.log(message);
  if (process.env.CHIPS_TEST_OPTIONAL === "1") {
    console.log("Set CHIPS_TEST_OPTIONAL=1 to skip locally. Skipping.");
    process.exit(0);
  }
  console.log("Set CHIPS_TEST_OPTIONAL=1 to skip locally.");
  process.exit(1);
}

function ensureInteger(value, label) {
  assert.ok(Number.isInteger(value), `${label} must be integer`);
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
  assert.equal(first.body?.sequenceOk, true, `initial sequenceOk should be true; ${formatResponse(first)}`);
  const entries = Array.isArray(first.body?.entries) ? first.body.entries : [];
  if (!entries.length) return;
  const lastSeq = entries[entries.length - 1].entry_seq;
  ensureInteger(lastSeq, "last entry_seq");
  const next = await getLedger(config, { after: lastSeq, limit: 20 });
  assert.equal(next.status, 200, `paged ledger should succeed; ${formatResponse(next)}`);
  assert.equal(next.body?.sequenceOk, true, `paged sequenceOk should be true; ${formatResponse(next)}`);
  const nextEntries = Array.isArray(next.body?.entries) ? next.body.entries : [];
  if (next.body?.sequenceOk === true && nextEntries.length) {
    assert.equal(
      nextEntries[0].entry_seq,
      lastSeq + 1,
      "paged entries must start at lastSeq + 1 when sequenceOk is true",
    );
  }
  for (const entry of nextEntries) {
    assert.ok(entry.entry_seq > lastSeq, "paged entries must advance cursor");
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
