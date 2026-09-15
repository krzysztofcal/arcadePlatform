#!/usr/bin/env bash
set -euo pipefail

GH_BIN="${GH_BIN:-/home/copilot/.local/bin/gh}"
REPO="krzysztofcal/arcadePlatform"
WORKFLOW_ID="349412824"
REF="main"
MODE="external-scheduled-automatic"
DAILY_MODE="external-existing-30d"
WORKFLOW_FILE=".github/workflows/chips-ledger-stage-scheduled-automation.yml"
RESOURCE_WORKFLOW_ID="353254812"

minute="$(date -u +%M)"
hour="$(date -u +%H)"

if [[ "$hour" == "02" && "$minute" == "04" ]]; then
  workflow_source="$(timeout 30s "$GH_BIN" api "repos/${REPO}/contents/${WORKFLOW_FILE}?ref=${REF}" \
    --jq .content | base64 --decode)"
  if ! grep -Eq '^[[:space:]]+- external-existing-30d$' <<<"$workflow_source"; then
    echo "skip: ${DAILY_MODE} is not advertised by ${REPO}@${REF}"
    exit 0
  fi

  timeout 30s "$GH_BIN" workflow run "${WORKFLOW_ID}" --repo "${REPO}" --ref "${REF}" -f "mode=${DAILY_MODE}"
  echo "dispatched ${DAILY_MODE} on ${REPO}@${REF} workflow ${WORKFLOW_ID}"
  exit 0
fi

if [[ "$minute" =~ ^(03|18|33|48)$ ]]; then
  if timeout 30s "$GH_BIN" workflow run "${RESOURCE_WORKFLOW_ID}" --repo "${REPO}" --ref "${REF}" >/dev/null 2>&1; then
    echo "dispatched stage-supabase-resource-health on ${REPO}@${REF} workflow ${RESOURCE_WORKFLOW_ID}"
  else
    echo "warn: failed to dispatch stage-supabase-resource-health; cleanup dispatch unaffected" >&2
  fi
  exit 0
fi

if [[ ! "$minute" =~ ^(02|17|32|47)$ ]]; then
  echo "skip: outside dispatch schedule"
  exit 0
fi

active="$("$GH_BIN" api "repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?per_page=100" \
  --jq '[.workflow_runs[] | select(.status == "in_progress" or .status == "queued" or .status == "pending")] | length')"

if [ "$active" -gt 0 ]; then
  echo "skip: active/queued/pending run exists for workflow ${WORKFLOW_ID}"
  exit 0
fi

"$GH_BIN" workflow run "${WORKFLOW_ID}" --repo "${REPO}" --ref "${REF}" -f "mode=${MODE}"
echo "dispatched ${MODE} on ${REPO}@${REF} workflow ${WORKFLOW_ID}"
