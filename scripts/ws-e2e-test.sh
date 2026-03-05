#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SUB="${1:-test_user}"
ROOM_ID="${ROOM_ID:-table_manual_test}"
WS_URL="${WS_URL:-wss://ws.kcswh.pl/ws}"
SITE_URL="${SITE_URL:-https://play.kcswh.pl}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1"; exit 1; }; }

need netlify
need curl
need jq
need node

echo "Fetching WS_MINT_ADMIN_SECRET from Netlify (production)..."
ADMIN_SECRET="$(netlify env:get WS_MINT_ADMIN_SECRET --context production | tr -d '\r')"
if [ -z "${ADMIN_SECRET}" ]; then
  echo "ERROR: WS_MINT_ADMIN_SECRET empty"
  exit 1
fi

echo "Minting WS token for sub=${SUB}..."
MINT_JSON="$(
  curl -sS "${SITE_URL}/.netlify/functions/ws-mint-token" \
    -H "content-type: application/json" \
    -H "x-ws-mint-secret: ${ADMIN_SECRET}" \
    -d "{\"sub\":\"${SUB}\"}"
)"

OK="$(echo "$MINT_JSON" | jq -r '.ok // false')"
if [ "$OK" != "true" ]; then
  echo "Mint failed:"
  echo "$MINT_JSON" | jq .
  exit 1
fi

TOKEN="$(echo "$MINT_JSON" | jq -r '.token')"
EXPIRES="$(echo "$MINT_JSON" | jq -r '.expiresInSec')"

echo "Token minted (expiresInSec=${EXPIRES})."
echo "$TOKEN"

# Clipboard (Termux) – optional
if command -v termux-clipboard-set >/dev/null 2>&1; then
  printf "%s" "$TOKEN" | termux-clipboard-set
  echo "Token copied to clipboard ✔"
else
  echo "termux-clipboard-set not found (skip clipboard)."
fi

echo "Running WS E2E: hello -> auth -> join"
echo "WS_URL=${WS_URL}"
echo "ROOM_ID=${ROOM_ID}"
echo

# Ensure ws is available (install locally if missing)
node -e "require('ws')" >/dev/null 2>&1 || {
  echo "Installing node dependency: ws (local)..."
  npm i ws@8 --silent
}

WS_URL="$WS_URL" ROOM_ID="$ROOM_ID" TOKEN="$TOKEN" node <<'NODE'
const WebSocket = require("ws");

const WS_URL = process.env.WS_URL;
const ROOM_ID = process.env.ROOM_ID || "";
const TOKEN = process.env.TOKEN;

function frame(obj) { return JSON.stringify(obj); }

function nowTs() { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }

function waitFor(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error("timeout_waiting_for_frame"));
    }, timeoutMs);

    function onMsg(buf) {
      const text = buf.toString("utf8");
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    }

    function onClose() {
      cleanup();
      reject(new Error("ws_closed"));
    }

    function cleanup() {
      clearTimeout(t);
      ws.off("message", onMsg);
      ws.off("close", onClose);
    }

    ws.on("message", onMsg);
    ws.on("close", onClose);
  });
}

(async () => {
  const ws = new WebSocket(WS_URL);

  ws.on("message", (buf) => {
    const text = buf.toString("utf8");
    process.stdout.write(`< ${text}\n`);
  });

  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });

  const hello = {
    version: "1.0",
    type: "hello",
    requestId: "1",
    ts: nowTs(),
    payload: { supportedVersions: ["1.0"], client: { name: "termux-node-ws", build: "ws-e2e-test.sh" } },
  };
  process.stdout.write(`> ${frame(hello)}\n`);
  ws.send(frame(hello));

  await waitFor(ws, (m) => m && m.type === "helloAck", 5000);

  const auth = {
    version: "1.0",
    type: "auth",
    requestId: "2",
    ts: nowTs(),
    payload: { token: TOKEN },
  };
  process.stdout.write(`> ${frame(auth)}\n`);
  ws.send(frame(auth));

  const authResp = await waitFor(ws, (m) => m && (m.type === "authOk" || m.type === "error"), 5000);
  if (authResp.type === "error") {
    throw new Error(`auth_failed:${authResp?.payload?.code || "unknown"}`);
  }

  if (ROOM_ID) {
    const join = {
      version: "1.0",
      type: "join",
      requestId: "3",
      roomId: ROOM_ID,
      ts: nowTs(),
      payload: { tableId: ROOM_ID },
    };
    process.stdout.write(`> ${frame(join)}\n`);
    ws.send(frame(join));

    // Expect either table_state / joinOk / error depending on server implementation
    await waitFor(ws, (m) => m && (m.type === "table_state" || m.type === "joinOk" || m.type === "error"), 8000);
  }

  ws.close();
  process.stdout.write("E2E done.\n");
})().catch((err) => {
  process.stderr.write(`E2E failed: ${err.message}\n`);
  process.exit(1);
});
NODE
