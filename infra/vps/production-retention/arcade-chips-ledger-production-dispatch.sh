#!/usr/bin/env bash
set -euo pipefail

# Deployment/provisioning is owner-gated. Missing switch/token never falls back
# to the Stage or an operator's ambient gh login. No DB/Storage credentials.
[[ "${CHIPS_LEDGER_PRODUCTION_AUTOMATION_ENABLED:-0}" == "1" ]] || exit 0
GH_BIN="${GH_BIN:-/home/copilot/.local/bin/gh}"
REPO="krzysztofcal/arcadePlatform"
WORKFLOW="chips-ledger-production-scheduled-automation.yml"
slot="$(date -u +%H:%M)"
case "$slot" in
  02:09) policy=existing-30d ;;
  ??:09) policy=bot-only-7d ;;
  ??:24) policy=closed-human-30d ;;
  ??:39) policy=escrow ;;
  *) exit 0 ;;
esac
: "${GH_TOKEN:?dedicated Production GH_TOKEN is required}"
: "${RUNTIME_DIRECTORY:?private service runtime directory is required}"
export GH_HOST=github.com
export GH_PROMPT_DISABLED=1
export GH_CONFIG_DIR="$RUNTIME_DIRECTORY/gh-production"
mkdir -p "$GH_CONFIG_DIR"
chmod 700 "$GH_CONFIG_DIR"
exec 9>"$RUNTIME_DIRECTORY/dispatch.lock"
flock -n 9 || { echo "skip: Production dispatcher lock busy"; exit 0; }
actor="$(timeout 30s "$GH_BIN" api user --jq .login)"
[[ "$actor" == "arcade-production-dispatch" ]] || { echo 'Production dispatcher actor mismatch' >&2; exit 1; }
for status in requested waiting pending queued in_progress; do
  runs="$(timeout 30s "$GH_BIN" api "repos/$REPO/actions/workflows/$WORKFLOW/runs?status=$status&per_page=1" \
    -H 'X-GitHub-Api-Version: 2026-03-10')"
  state="$(printf '%s' "$runs" | node -e '
    let raw=""; process.stdin.on("data", x => raw+=x); process.stdin.on("end", () => {
      const x=JSON.parse(raw);
      if (!Number.isSafeInteger(x.total_count) || x.total_count<0 || !Array.isArray(x.workflow_runs)
        || (x.total_count===0 && x.workflow_runs.length!==0)
        || (x.total_count>0 && x.workflow_runs.length!==1)) process.exit(1);
      process.stdout.write(x.total_count===0 ? "clear" : "busy");
    });')"
  [[ "$state" == "clear" ]] || { echo "skip: Production workflow has $status run"; exit 0; }
done
# Slow guards must not dispatch a stale slot. No catch-up or POST retry.
[[ "$(date -u +%H:%M)" == "$slot" ]] || { echo "skip: Production slot expired"; exit 0; }
timeout 30s "$GH_BIN" workflow run "$WORKFLOW" --repo "$REPO" --ref main \
  -f "policy=$policy" -f mode=automatic
echo "dispatched Production $policy on $REPO@main"
