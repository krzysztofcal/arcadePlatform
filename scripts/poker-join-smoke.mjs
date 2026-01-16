const joinUrl = process.env.POKER_JOIN_URL;
const authToken = process.env.POKER_AUTH_TOKEN;
const tableId = process.env.POKER_TABLE_ID;
const seatNo = Number.parseInt(process.env.POKER_SEAT_NO ?? "0", 10);
const buyIn = Number.parseInt(process.env.POKER_BUY_IN ?? "100", 10);
const count = Number.parseInt(process.env.POKER_JOIN_COUNT ?? "20", 10);

if (!joinUrl || !authToken || !tableId) {
  console.error("Missing required env vars: POKER_JOIN_URL, POKER_AUTH_TOKEN, POKER_TABLE_ID");
  process.exit(1);
}

if (!Number.isFinite(seatNo) || seatNo < 0) {
  console.error("POKER_SEAT_NO must be a non-negative integer");
  process.exit(1);
}

if (!Number.isFinite(buyIn) || buyIn <= 0) {
  console.error("POKER_BUY_IN must be a positive integer");
  process.exit(1);
}

const run = async () => {
  const results = [];
  for (let i = 0; i < count; i += 1) {
    const requestId = `smoke-${Date.now()}-${i}`;
    const response = await fetch(joinUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ tableId, seatNo, buyIn, requestId }),
    });

    const text = await response.text();
    results.push({ status: response.status, body: text });
    const summary = text.length > 120 ? `${text.slice(0, 120)}…` : text;
    console.log(`#${i + 1}/${count} status=${response.status} body=${summary}`);
  }

  const failures = results.filter((item) => item.status !== 200);
  if (failures.length > 0) {
    console.error(`Completed with ${failures.length} non-200 responses.`);
    process.exit(1);
  }

  console.log(`Completed ${count} join requests successfully.`);
};

run().catch((error) => {
  console.error("Smoke test failed", error);
  process.exit(1);
});
