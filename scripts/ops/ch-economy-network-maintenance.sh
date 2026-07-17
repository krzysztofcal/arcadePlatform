#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

readonly SUPABASE_CLI_VERSION="2.109.1"
readonly CANONICAL_STAGE_PROJECT_REF="krydukthwdvccggbyjfw"
readonly CANONICAL_PROD_PROJECT_REF="otbqfijerkieoxwpxjnm"
readonly DEFAULT_STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/arcade-platform"
readonly STATE_DIR="${CH_ECONOMY_NETWORK_STATE_DIR:-$DEFAULT_STATE_DIR}"
readonly LOCK_FILE="$STATE_DIR/ch-economy-network-maintenance.lock"
readonly APPLY_TIMEOUT_SECONDS="${NETWORK_RESTRICTIONS_APPLY_TIMEOUT_SECONDS:-120}"
readonly POLL_INTERVAL_SECONDS="${NETWORK_RESTRICTIONS_POLL_INTERVAL_SECONDS:-2}"

TARGET=""
CANONICAL_PROJECT_REF=""
EXPECTED_PROJECT_REF=""
DB_URL=""
DB_PROJECT_REF=""
WS_SERVICE_NAME=""
RECOVERY_FILE=""

usage() {
  cat <<'EOF'
Usage: scripts/ops/ch-economy-network-maintenance.sh <preflight|restrict|status|restore|cancel|migrate-recovery>

Required environment:
  RESET_TARGET=stage|prod
  SUPABASE_STAGE_DB_URL=<stage direct/pooler PostgreSQL URL> (when target=stage)
  EXPECTED_SUPABASE_STAGE_PROJECT_REF=<independently verified stage ref>
  SUPABASE_PROD_DB_URL=<production direct/pooler PostgreSQL URL> (when target=prod)
  EXPECTED_SUPABASE_PROD_PROJECT_REF=<independently verified production ref>
  VPS_IPV4_CIDR=<current public VPS IPv4/32> (preflight/restrict/migrate-recovery)

Production restrict additionally requires:
  NETWORK_MAINTENANCE_CONFIRM=RESTRICT_PROD_<canonical-production-project-ref>

Optional environment:
  VPS_IPV6_CIDR=<current public VPS IPv6/128>
  SUPABASE_ACCESS_TOKEN=<Management API token; otherwise an existing CLI login is used>
  CH_ECONOMY_NETWORK_STATE_DIR=<private state directory outside the repository>

The script never stops/starts services, changes CHIPS_ENABLED, runs backup/reset SQL,
or restores restrictions automatically from an EXIT trap.
EOF
}

fail() {
  printf 'STOP: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

run_node() {
  node -e "$1"
}

derive_project_ref() {
  DB_URL_VALUE="$1" run_node '
    const raw = String(process.env.DB_URL_VALUE || "");
    let url;
    try { url = new URL(raw); } catch { process.exit(2); }
    const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
    const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(url.hostname);
    const user = /^postgres\.([a-z0-9]{20})$/i.exec(decodeURIComponent(url.username || ""));
    const ref = direct?.[1] || (pooler ? user?.[1] : null);
    if (!ref) process.exit(3);
    process.stdout.write(ref.toLowerCase());
  ' || fail "selected target DB URL does not expose a supported Supabase project ref"
}

validate_target() {
  require_value RESET_TARGET
  require_value EXPECTED_SUPABASE_STAGE_PROJECT_REF
  require_value EXPECTED_SUPABASE_PROD_PROJECT_REF
  [[ "$EXPECTED_SUPABASE_STAGE_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || fail "EXPECTED_SUPABASE_STAGE_PROJECT_REF has an invalid format"
  [[ "$EXPECTED_SUPABASE_PROD_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || fail "EXPECTED_SUPABASE_PROD_PROJECT_REF has an invalid format"
  [[ "$EXPECTED_SUPABASE_STAGE_PROJECT_REF" != "$EXPECTED_SUPABASE_PROD_PROJECT_REF" ]] || fail "stage and production expected refs must differ"

  case "$RESET_TARGET" in
    stage)
      TARGET="stage"
      require_value SUPABASE_STAGE_DB_URL
      DB_URL="$SUPABASE_STAGE_DB_URL"
      EXPECTED_PROJECT_REF="$EXPECTED_SUPABASE_STAGE_PROJECT_REF"
      CANONICAL_PROJECT_REF="$CANONICAL_STAGE_PROJECT_REF"
      WS_SERVICE_NAME="ws-server-preview.service"
      ;;
    prod)
      TARGET="prod"
      require_value SUPABASE_PROD_DB_URL
      DB_URL="$SUPABASE_PROD_DB_URL"
      EXPECTED_PROJECT_REF="$EXPECTED_SUPABASE_PROD_PROJECT_REF"
      CANONICAL_PROJECT_REF="$CANONICAL_PROD_PROJECT_REF"
      WS_SERVICE_NAME="ws-server.service"
      ;;
    *) fail "RESET_TARGET must be exactly stage or prod" ;;
  esac

  DB_PROJECT_REF="$(derive_project_ref "$DB_URL")"
  [[ "$EXPECTED_PROJECT_REF" == "$CANONICAL_PROJECT_REF" ]] || fail "$TARGET expected ref does not match the versioned canonical ref"
  [[ "$DB_PROJECT_REF" == "$CANONICAL_PROJECT_REF" ]] || fail "$TARGET DB URL does not match the versioned canonical ref"
  [[ "$CANONICAL_STAGE_PROJECT_REF" != "$CANONICAL_PROD_PROJECT_REF" ]] || fail "versioned stage and production refs must differ"
  RECOVERY_FILE="$STATE_DIR/$TARGET-network-restrictions.json"
}

acquire_lock() {
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  exec 9>"$LOCK_FILE"
  chmod 600 "$LOCK_FILE"
  flock -n 9 || fail "another CH economy network maintenance operation holds $LOCK_FILE"
}

run_supabase_cli() {
  if [[ -n "${SUPABASE_CLI_BIN:-}" ]]; then
    "$SUPABASE_CLI_BIN" "$@"
  else
    npx --yes "supabase@$SUPABASE_CLI_VERSION" "$@"
  fi
}

verify_cli_version() {
  local actual
  actual="$(run_supabase_cli --version)" || fail "Supabase CLI is unavailable or not authorized"
  [[ "$actual" == "$SUPABASE_CLI_VERSION" ]] || fail "Supabase CLI version mismatch: expected $SUPABASE_CLI_VERSION, got $actual"
}

validate_cidr() {
  local family="$1" value="$2"
  CIDR_FAMILY="$family" CIDR_VALUE="$value" run_node '
    const net = require("node:net");
    const family = Number(process.env.CIDR_FAMILY);
    const value = String(process.env.CIDR_VALUE || "");
    const suffix = family === 4 ? "/32" : "/128";
    if (!value.endsWith(suffix) || net.isIP(value.slice(0, -suffix.length)) !== family) process.exit(1);
  ' || fail "invalid IPv$family host CIDR: $value"
}

run_curl() {
  if [[ -n "${NETWORK_MAINTENANCE_CURL_BIN:-}" ]]; then
    "$NETWORK_MAINTENANCE_CURL_BIN" "$@"
  else
    curl "$@"
  fi
}

verify_vps_cidrs() {
  require_value VPS_IPV4_CIDR
  validate_cidr 4 "$VPS_IPV4_CIDR"
  local expected_ipv4 detected_ipv4
  expected_ipv4="${VPS_IPV4_CIDR%/32}"
  detected_ipv4="$(run_curl -4fsS --max-time 10 https://api.ipify.org)" || fail "could not verify the VPS public IPv4 address"
  [[ "$detected_ipv4" == "$expected_ipv4" ]] || fail "VPS IPv4 mismatch: expected $expected_ipv4, detected $detected_ipv4"

  if [[ -n "${VPS_IPV6_CIDR:-}" ]]; then
    validate_cidr 6 "$VPS_IPV6_CIDR"
    local expected_ipv6 detected_ipv6
    expected_ipv6="${VPS_IPV6_CIDR%/128}"
    detected_ipv6="$(run_curl -6fsS --max-time 10 https://api64.ipify.org)" || fail "could not verify the VPS public IPv6 address"
    EXPECTED_IP="$expected_ipv6" DETECTED_IP="$detected_ipv6" run_node '
      const net = require("node:net");
      const expand = (value) => {
        if (net.isIP(value) !== 6) process.exit(1);
        const [left, right = ""] = value.toLowerCase().split("::");
        const lhs = left ? left.split(":") : [];
        const rhs = right ? right.split(":") : [];
        const missing = 8 - lhs.length - rhs.length;
        if (missing < 0) process.exit(1);
        return [...lhs, ...Array(missing).fill("0"), ...rhs].map((part) => part.padStart(4, "0")).join(":");
      };
      if (expand(process.env.EXPECTED_IP) !== expand(process.env.DETECTED_IP)) process.exit(1);
    ' || fail "VPS IPv6 mismatch: expected $expected_ipv6, detected $detected_ipv6"
  fi
}

validate_network_response() {
  run_node '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let value;
      try { value = JSON.parse(raw); } catch { process.exit(2); }
      const config = value && value.config;
      const validArray = (items) => Array.isArray(items) && items.every((item) => typeof item === "string" && item.length > 0 && !item.includes("\n"));
      if (value.entitlement !== "allowed" || typeof value.status !== "string" || value.status.length === 0 || !config ||
          !validArray(config.dbAllowedCidrs) || !validArray(config.dbAllowedCidrsV6)) process.exit(3);
      process.stdout.write(JSON.stringify({ entitlement: value.entitlement, status: value.status, config: {
        dbAllowedCidrs: config.dbAllowedCidrs, dbAllowedCidrsV6: config.dbAllowedCidrsV6
      }}));
    });
  '
}

get_network_response() {
  local raw
  raw="$(run_supabase_cli network-restrictions get --project-ref "$CANONICAL_PROJECT_REF" --experimental --output json)" || fail "could not read Supabase Network Restrictions"
  printf '%s' "$raw" | validate_network_response || fail "unexpected or unauthorized Network Restrictions response"
}

response_status() { NETWORK_RESPONSE="$1" run_node 'process.stdout.write(JSON.parse(process.env.NETWORK_RESPONSE).status)'; }
response_config() { NETWORK_RESPONSE="$1" run_node 'process.stdout.write(JSON.stringify(JSON.parse(process.env.NETWORK_RESPONSE).config))'; }

canonical_config() {
  CONFIG_JSON="$1" run_node '
    const value = JSON.parse(process.env.CONFIG_JSON);
    const normalize = (items) => [...new Set(items)].sort();
    process.stdout.write(JSON.stringify({ dbAllowedCidrs: normalize(value.dbAllowedCidrs), dbAllowedCidrsV6: normalize(value.dbAllowedCidrsV6) }));
  '
}

configs_equal() { [[ "$(canonical_config "$1")" == "$(canonical_config "$2")" ]]; }

config_mode() {
  local config="$1" unrestricted='{"dbAllowedCidrs":["0.0.0.0/0"],"dbAllowedCidrsV6":["::/0"]}'
  if configs_equal "$config" "$unrestricted"; then printf 'unrestricted'; else printf 'restricted'; fi
}

restricted_config() {
  IPV4_CIDR="$VPS_IPV4_CIDR" IPV6_CIDR="${VPS_IPV6_CIDR:-}" run_node '
    const v6 = process.env.IPV6_CIDR;
    process.stdout.write(JSON.stringify({ dbAllowedCidrs: [process.env.IPV4_CIDR], dbAllowedCidrsV6: v6 ? [v6] : [] }));
  '
}

atomic_write_recovery() {
  local payload="$1" temp_file
  temp_file="$(mktemp "$STATE_DIR/.$TARGET-network-restrictions.XXXXXX")"
  printf '%s\n' "$payload" > "$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" "$RECOVERY_FILE"
}

build_recovery_payload() {
  local phase="$1" previous="$2" desired="$3" captured_at="${4:-}"
  TARGET_VALUE="$TARGET" PROJECT_REF="$CANONICAL_PROJECT_REF" CLI_VERSION="$SUPABASE_CLI_VERSION" PHASE="$phase" \
    PREVIOUS_CONFIG="$previous" DESIRED_CONFIG="$desired" CAPTURED_AT="$captured_at" run_node '
      const previous = JSON.parse(process.env.PREVIOUS_CONFIG);
      const desired = JSON.parse(process.env.DESIRED_CONFIG);
      const phase = process.env.PHASE;
      const now = new Date().toISOString();
      const payload = {
        schemaVersion: 2,
        target: process.env.TARGET_VALUE,
        projectRef: process.env.PROJECT_REF,
        phase,
        capturedAt: process.env.CAPTURED_AT || now,
        phaseUpdatedAt: now,
        supabaseCliVersion: process.env.CLI_VERSION,
        previousMode: null,
        previousConfig: previous,
        desiredConfig: desired
      };
      const canonical = (items) => [...new Set(items)].sort();
      const fullOpen = JSON.stringify({ dbAllowedCidrs: ["0.0.0.0/0"], dbAllowedCidrsV6: ["::/0"] });
      const normalized = JSON.stringify({ dbAllowedCidrs: canonical(previous.dbAllowedCidrs), dbAllowedCidrsV6: canonical(previous.dbAllowedCidrsV6) });
      payload.previousMode = normalized === fullOpen ? "unrestricted" : "restricted";
      process.stdout.write(JSON.stringify(payload, null, 2));
    '
}

read_recovery_json() {
  [[ -f "$RECOVERY_FILE" ]] || fail "recovery file is missing: $RECOVERY_FILE"
  [[ "$(stat -c '%a' "$RECOVERY_FILE")" == "600" ]] || fail "recovery file permissions must be 600"
  TARGET_VALUE="$TARGET" PROJECT_REF="$CANONICAL_PROJECT_REF" RECOVERY_PATH="$RECOVERY_FILE" run_node '
    const fs = require("node:fs");
    let value;
    try { value = JSON.parse(fs.readFileSync(process.env.RECOVERY_PATH, "utf8")); } catch { process.exit(2); }
    const validArray = (items) => Array.isArray(items) && items.every((item) => typeof item === "string" && item.length > 0 && !item.includes("\n"));
    const validConfig = (config) => config && validArray(config.dbAllowedCidrs) && validArray(config.dbAllowedCidrsV6) &&
      config.dbAllowedCidrs.length + config.dbAllowedCidrsV6.length > 0;
    if (value.schemaVersion !== 2 || value.target !== process.env.TARGET_VALUE || value.projectRef !== process.env.PROJECT_REF ||
        value.supabaseCliVersion !== "2.109.1" || !["captured", "restricting", "restricted"].includes(value.phase) ||
        !validConfig(value.previousConfig) || !validConfig(value.desiredConfig) ||
        !["restricted", "unrestricted"].includes(value.previousMode)) process.exit(3);
    process.stdout.write(JSON.stringify(value));
  ' || fail "active recovery is legacy, malformed, or targets a different environment; use migrate-recovery only for reviewed stage schema v1"
}

recovery_field() {
  RECOVERY_JSON="$1" FIELD="$2" run_node '
    const value = JSON.parse(process.env.RECOVERY_JSON);
    const result = value[process.env.FIELD];
    process.stdout.write(typeof result === "string" ? result : JSON.stringify(result));
  '
}

write_recovery_phase() {
  local recovery="$1" phase="$2" previous desired captured
  previous="$(recovery_field "$recovery" previousConfig)"
  desired="$(recovery_field "$recovery" desiredConfig)"
  captured="$(recovery_field "$recovery" capturedAt)"
  atomic_write_recovery "$(build_recovery_payload "$phase" "$previous" "$desired" "$captured")"
}

ensure_no_active_recovery() {
  local target path
  for target in stage prod; do
    path="$STATE_DIR/$target-network-restrictions.json"
    [[ ! -e "$path" ]] || fail "unresolved $target recovery blocks new preflight: $path"
  done
}

apply_config() {
  local config="$1"; local -a cidrs=()
  mapfile -t cidrs < <(CONFIG_JSON="$config" run_node '
    const c = JSON.parse(process.env.CONFIG_JSON);
    for (const item of [...c.dbAllowedCidrs, ...c.dbAllowedCidrsV6]) process.stdout.write(`${item}\n`);
  ')
  [[ "${#cidrs[@]}" -gt 0 ]] || fail "refusing to apply an empty CIDR list"
  local -a args=(network-restrictions update --project-ref "$CANONICAL_PROJECT_REF")
  local cidr
  for cidr in "${cidrs[@]}"; do args+=(--db-allow-cidr "$cidr"); done
  args+=(--experimental --output json)
  run_supabase_cli "${args[@]}" >/dev/null || fail "Network Restrictions update failed; keep WS stopped and recovery active"
}

wait_for_config() {
  local expected="$1" transitional="${2:-}" started now response status current
  started="$(date +%s)"
  while true; do
    response="$(get_network_response)"
    status="$(response_status "$response")"
    current="$(response_config "$response")"
    if [[ "$status" == "applied" ]] && configs_equal "$current" "$expected"; then return 0; fi
    if ! configs_equal "$current" "$expected"; then
      [[ -n "$transitional" ]] && configs_equal "$current" "$transitional" || fail "Network Restrictions changed to an unexpected configuration while waiting"
    fi
    now="$(date +%s)"
    (( now - started < APPLY_TIMEOUT_SECONDS )) || fail "timed out waiting for status=applied and exact expected CIDRs"
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

run_systemctl() {
  if [[ -n "${NETWORK_MAINTENANCE_SYSTEMCTL_BIN:-}" ]]; then "$NETWORK_MAINTENANCE_SYSTEMCTL_BIN" "$@"; else systemctl "$@"; fi
}

require_ws_inactive() {
  local state
  state="$(run_systemctl is-active "$WS_SERVICE_NAME" 2>/dev/null || true)"
  [[ "$state" == "inactive" ]] || fail "$WS_SERVICE_NAME must be inactive; current state: ${state:-unknown}"
}

archive_recovery_file() {
  local outcome="$1" archived
  archived="$RECOVERY_FILE.$outcome-$(date -u +%Y%m%dT%H%M%SZ)"
  [[ ! -e "$archived" ]] || fail "recovery archive already exists: $archived"
  mv "$RECOVERY_FILE" "$archived"
  chmod 600 "$archived"
  printf 'Recovery evidence archived at %s\n' "$archived"
}

test_checkpoint() {
  [[ "${NETWORK_MAINTENANCE_TEST_MODE:-0}" == "1" && "${NETWORK_MAINTENANCE_TEST_STOP_AFTER:-}" == "$1" ]] || return 0
  printf 'TEST CHECKPOINT STOP: %s\n' "$1" >&2
  exit 86
}

command_preflight() {
  ensure_no_active_recovery
  verify_vps_cidrs
  verify_cli_version
  local response status previous desired
  response="$(get_network_response)"
  status="$(response_status "$response")"
  [[ "$status" == "applied" ]] || fail "current Network Restrictions status is $status, expected applied"
  previous="$(response_config "$response")"
  desired="$(restricted_config)"
  atomic_write_recovery "$(build_recovery_payload captured "$previous" "$desired")"
  printf 'NETWORK PREFLIGHT PASSED for %s. Previous configuration saved to %s\n' "$TARGET" "$RECOVERY_FILE"
  printf 'No Network Restrictions were modified.\n'
}

command_restrict() {
  require_ws_inactive
  verify_vps_cidrs
  verify_cli_version
  if [[ "$TARGET" == "prod" ]]; then
    [[ "${NETWORK_MAINTENANCE_CONFIRM:-}" == "RESTRICT_PROD_$CANONICAL_PROD_PROJECT_REF" ]] || fail "production restrict confirmation is missing or incorrect"
  fi
  local recovery phase previous desired response status current
  recovery="$(read_recovery_json)"
  phase="$(recovery_field "$recovery" phase)"
  previous="$(recovery_field "$recovery" previousConfig)"
  desired="$(recovery_field "$recovery" desiredConfig)"
  configs_equal "$desired" "$(restricted_config)" || fail "current VPS CIDRs differ from the target stored in recovery"
  [[ "$phase" != "restricted" ]] || {
    response="$(get_network_response)"; status="$(response_status "$response")"; current="$(response_config "$response")"
    [[ "$status" == "applied" ]] && configs_equal "$current" "$desired" || fail "restricted recovery does not match current API configuration"
    printf 'NETWORK RESTRICTION VERIFIED for %s.\n' "$TARGET"; return
  }

  response="$(get_network_response)"
  status="$(response_status "$response")"
  current="$(response_config "$response")"
  if [[ "$phase" == "captured" ]]; then
    [[ "$status" == "applied" ]] && configs_equal "$current" "$previous" || fail "captured recovery no longer matches current restrictions"
    write_recovery_phase "$recovery" restricting
    recovery="$(read_recovery_json)"
    phase="restricting"
    test_checkpoint phase-restricting
  fi

  if configs_equal "$current" "$previous"; then
    [[ "$status" == "applied" ]] || fail "original configuration is transitional; refusing automatic update"
    apply_config "$desired"
    test_checkpoint api-update
    wait_for_config "$desired" "$previous"
  elif configs_equal "$current" "$desired"; then
    [[ "$status" == "applied" ]] || wait_for_config "$desired" "$previous"
  else
    fail "restricting recovery matches neither captured nor intended VPS-only configuration; use Dashboard recovery"
  fi
  test_checkpoint convergence
  write_recovery_phase "$(read_recovery_json)" restricted
  printf 'NETWORK RESTRICTION APPLIED for %s. Postgres is limited to the saved VPS CIDRs.\n' "$TARGET"
}

command_cancel() {
  verify_cli_version
  local recovery phase previous response status current
  recovery="$(read_recovery_json)"
  phase="$(recovery_field "$recovery" phase)"
  [[ "$phase" == "captured" || "$phase" == "restricting" ]] || fail "restricted recovery must be resolved with restore"
  previous="$(recovery_field "$recovery" previousConfig)"
  response="$(get_network_response)"; status="$(response_status "$response")"; current="$(response_config "$response")"
  [[ "$status" == "applied" ]] || fail "cannot cancel while Network Restrictions status is $status"
  configs_equal "$current" "$previous" || fail "current restrictions differ from captured snapshot; cancel is not safe"
  archive_recovery_file cancelled
  printf 'NETWORK PREFLIGHT CANCELLED for %s. No API update was issued.\n' "$TARGET"
}

command_restore() {
  require_ws_inactive
  verify_cli_version
  local recovery phase previous desired response status current
  recovery="$(read_recovery_json)"
  phase="$(recovery_field "$recovery" phase)"
  [[ "$phase" == "restricting" || "$phase" == "restricted" ]] || fail "captured recovery must be resolved with cancel"
  previous="$(recovery_field "$recovery" previousConfig)"
  desired="$(recovery_field "$recovery" desiredConfig)"
  response="$(get_network_response)"; status="$(response_status "$response")"; current="$(response_config "$response")"
  if configs_equal "$current" "$previous"; then
    [[ "$status" == "applied" ]] || wait_for_config "$previous" "$desired"
  elif configs_equal "$current" "$desired"; then
    apply_config "$previous"
    wait_for_config "$previous" "$desired"
  else
    fail "current restrictions match neither captured nor intended VPS-only configuration; use Dashboard recovery"
  fi
  archive_recovery_file restored
  printf 'NETWORK RESTORE VERIFIED for %s. Start Netlify/WS only after remaining runbook gates pass.\n' "$TARGET"
}

command_status() {
  verify_cli_version
  local response status current mode="untracked" phase="none"
  response="$(get_network_response)"; status="$(response_status "$response")"; current="$(response_config "$response")"
  if [[ -f "$RECOVERY_FILE" ]]; then
    local recovery previous desired
    recovery="$(read_recovery_json)"
    phase="$(recovery_field "$recovery" phase)"
    previous="$(recovery_field "$recovery" previousConfig)"
    desired="$(recovery_field "$recovery" desiredConfig)"
    if configs_equal "$current" "$previous"; then mode="saved-original";
    elif configs_equal "$current" "$desired"; then mode="restricted-to-vps";
    else fail "active recovery exists but current configuration is unexpected"; fi
  fi
  TARGET_VALUE="$TARGET" PROJECT_REF="$CANONICAL_PROJECT_REF" STATUS_VALUE="$status" MODE_VALUE="$mode" PHASE_VALUE="$phase" CONFIG_JSON="$current" run_node '
    process.stdout.write(`${JSON.stringify({ target: process.env.TARGET_VALUE, projectRef: process.env.PROJECT_REF,
      status: process.env.STATUS_VALUE, mode: process.env.MODE_VALUE, recoveryPhase: process.env.PHASE_VALUE,
      config: JSON.parse(process.env.CONFIG_JSON) }, null, 2)}\n`);
  '
  [[ "$status" == "applied" ]] || fail "Network Restrictions are not applied"
}

command_migrate_recovery() {
  [[ "$TARGET" == "stage" ]] || fail "legacy schema v1 migration is stage-only"
  [[ -f "$RECOVERY_FILE" ]] || fail "legacy recovery file is missing: $RECOVERY_FILE"
  [[ "$(stat -c '%a' "$RECOVERY_FILE")" == "600" ]] || fail "legacy recovery permissions must be 600"
  verify_vps_cidrs
  verify_cli_version
  local legacy previous desired captured response status current
  legacy="$(PROJECT_REF="$CANONICAL_STAGE_PROJECT_REF" RECOVERY_PATH="$RECOVERY_FILE" run_node '
    const fs = require("node:fs"); let v;
    try { v = JSON.parse(fs.readFileSync(process.env.RECOVERY_PATH, "utf8")); } catch { process.exit(2); }
    const c = v?.config; const ok = (a) => Array.isArray(a) && a.every((x) => typeof x === "string" && x.length > 0);
    if (v?.schemaVersion !== 1 || v.projectRef !== process.env.PROJECT_REF || v.supabaseCliVersion !== "2.109.1" ||
        !c || !ok(c.dbAllowedCidrs) || !ok(c.dbAllowedCidrsV6) || c.dbAllowedCidrs.length + c.dbAllowedCidrsV6.length === 0) process.exit(3);
    process.stdout.write(JSON.stringify(v));
  ')" || fail "active recovery is not an exact reviewed stage schema v1 file"
  previous="$(recovery_field "$legacy" config)"
  captured="$(recovery_field "$legacy" capturedAt)"
  desired="$(restricted_config)"
  response="$(get_network_response)"; status="$(response_status "$response")"; current="$(response_config "$response")"
  [[ "$status" == "applied" ]] || fail "legacy migration requires status=applied"
  if configs_equal "$current" "$previous"; then
    archive_recovery_file legacy-resolved
    printf 'LEGACY RECOVERY RESOLVED without API update.\n'
  elif configs_equal "$current" "$desired"; then
    atomic_write_recovery "$(build_recovery_payload restricted "$previous" "$desired" "$captured")"
    printf 'LEGACY RECOVERY MIGRATED to schema v2 restricted phase without API update.\n'
  else
    fail "legacy recovery is ambiguous; retain it and use Dashboard review"
  fi
}

main() {
  [[ "$#" -eq 1 ]] || { usage >&2; exit 2; }
  if [[ -n "${SUPABASE_CLI_BIN:-}${NETWORK_MAINTENANCE_CURL_BIN:-}${NETWORK_MAINTENANCE_SYSTEMCTL_BIN:-}${NETWORK_MAINTENANCE_TEST_STOP_AFTER:-}" ]]; then
    [[ "${NETWORK_MAINTENANCE_TEST_MODE:-0}" == "1" ]] || fail "test command injection requires NETWORK_MAINTENANCE_TEST_MODE=1"
  fi
  require_command node
  require_command flock
  require_command stat
  if [[ -z "${SUPABASE_CLI_BIN:-}" ]]; then require_command npx; fi
  if [[ -z "${NETWORK_MAINTENANCE_SYSTEMCTL_BIN:-}" ]]; then require_command systemctl; fi
  if [[ -z "${NETWORK_MAINTENANCE_CURL_BIN:-}" ]]; then require_command curl; fi
  validate_target
  acquire_lock

  case "$1" in
    preflight) command_preflight ;;
    restrict) command_restrict ;;
    status) command_status ;;
    restore) command_restore ;;
    cancel) command_cancel ;;
    migrate-recovery) command_migrate_recovery ;;
    *) usage >&2; exit 2 ;;
  esac
}

main "$@"
