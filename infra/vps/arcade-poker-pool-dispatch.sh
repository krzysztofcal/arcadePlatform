#!/usr/bin/env bash
set -euo pipefail

GH_BIN="${GH_BIN:-/home/copilot/.local/bin/gh}"
REPO="krzysztofcal/arcadePlatform"
WORKFLOW_FILE=".github/workflows/poker-bot-pool-refill.yml"
REF="${POKER_BOT_REFILL_REF:-main}"
TARGET="${POKER_BOT_REFILL_TARGET:-stage}"
MODE="${POKER_BOT_REFILL_MODE:-dry-run}"

if [[ "$REPO" != "krzysztofcal/arcadePlatform" ]]; then
  echo "refusing refill dispatch: repository contract changed" >&2
  exit 1
fi
if [[ "$TARGET" != "stage" && "$TARGET" != "production" ]]; then
  echo "refusing refill dispatch: invalid target" >&2
  exit 1
fi
if [[ "$MODE" != "dry-run" ]]; then
  echo "refusing refill dispatch: VPS may dispatch dry-run only" >&2
  exit 1
fi
if [[ ! -x "$GH_BIN" ]]; then
  echo "refusing refill dispatch: GitHub CLI is unavailable" >&2
  exit 1
fi

timeout 30s "$GH_BIN" workflow run "$WORKFLOW_FILE" \
  --repo "$REPO" \
  --ref "$REF" \
  -f "target=$TARGET" \
  -f "mode=$MODE" \
  -f "reviewed_ref=$REF"
echo "dispatched dry-run refill on ${REPO}@${REF}"
