#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

readonly SUPABASE_CLI_VERSION="2.109.1"
readonly DEFAULT_STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/arcade-platform"
readonly STATE_DIR="${STAGE_NETWORK_STATE_DIR:-$DEFAULT_STATE_DIR}"
readonly RECOVERY_FILE="${STAGE_NETWORK_RECOVERY_FILE:-$STATE_DIR/stage-network-restrictions.json}"
readonly LOCK_FILE="${STAGE_NETWORK_LOCK_FILE:-$STATE_DIR/stage-network-restrictions.lock}"
readonly WS_SERVICE_NAME="${WS_PREVIEW_SERVICE_NAME:-ws-server-preview.service}"
readonly APPLY_TIMEOUT_SECONDS="${NETWORK_RESTRICTIONS_APPLY_TIMEOUT_SECONDS:-120}"
readonly POLL_INTERVAL_SECONDS="${NETWORK_RESTRICTIONS_POLL_INTERVAL_SECONDS:-2}"

usage() {
  cat <<'EOF'
Usage: scripts/ops/stage-network-maintenance.sh <preflight|restrict|status|restore>

Required environment:
  RESET_TARGET=stage
  EXPECTED_SUPABASE_PROJECT_REF=<independently verified stage ref>
  SUPABASE_PROJECT_REF=<stage ref derived from the stage DB URL>
  VPS_IPV4_CIDR=<current public VPS IPv4/32>

Optional environment:
  VPS_IPV6_CIDR=<current public VPS IPv6/128>
  SUPABASE_ACCESS_TOKEN=<Management API token; otherwise an existing CLI login is used>
  STAGE_NETWORK_STATE_DIR=<private state directory outside the repository>
  SUPABASE_CLI_BIN=<test-only executable replacing the pinned CLI invocation>

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

acquire_lock() {
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  exec 9>"$LOCK_FILE"
  chmod 600 "$LOCK_FILE"
  flock -n 9 || fail "another stage network maintenance operation holds $LOCK_FILE"
}

validate_target() {
  require_value RESET_TARGET
  require_value EXPECTED_SUPABASE_PROJECT_REF
  require_value SUPABASE_PROJECT_REF
  [[ "$RESET_TARGET" == "stage" ]] || fail "RESET_TARGET must be exactly stage"
  [[ "$EXPECTED_SUPABASE_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || fail "EXPECTED_SUPABASE_PROJECT_REF has an invalid format"
  [[ "$SUPABASE_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]] || fail "SUPABASE_PROJECT_REF has an invalid format"
  [[ "$SUPABASE_PROJECT_REF" == "$EXPECTED_SUPABASE_PROJECT_REF" ]] || fail "project ref mismatch"
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
  local family="$1"
  local value="$2"
  CIDR_FAMILY="$family" CIDR_VALUE="$value" node -e '
    const net = require("node:net");
    const family = Number(process.env.CIDR_FAMILY);
    const value = String(process.env.CIDR_VALUE || "");
    const suffix = family === 4 ? "/32" : "/128";
    if (!value.endsWith(suffix) || net.isIP(value.slice(0, -suffix.length)) !== family) process.exit(1);
  ' || fail "invalid IPv$family host CIDR: $value"
}

verify_vps_cidrs() {
  require_value VPS_IPV4_CIDR
  validate_cidr 4 "$VPS_IPV4_CIDR"

  local expected_ipv4 detected_ipv4
  expected_ipv4="${VPS_IPV4_CIDR%/32}"
  detected_ipv4="$(curl -4fsS --max-time 10 https://api.ipify.org)" || fail "could not verify the VPS public IPv4 address"
  [[ "$detected_ipv4" == "$expected_ipv4" ]] || fail "VPS IPv4 mismatch: expected $expected_ipv4, detected $detected_ipv4"

  if [[ -n "${VPS_IPV6_CIDR:-}" ]]; then
    validate_cidr 6 "$VPS_IPV6_CIDR"
    local expected_ipv6 detected_ipv6
    expected_ipv6="${VPS_IPV6_CIDR%/128}"
    detected_ipv6="$(curl -6fsS --max-time 10 https://api64.ipify.org)" || fail "could not verify the VPS public IPv6 address"
    EXPECTED_IP="$expected_ipv6" DETECTED_IP="$detected_ipv6" node -e '
      const net = require("node:net");
      const { isDeepStrictEqual } = require("node:util");
      const expand = (value) => {
        if (net.isIP(value) !== 6) process.exit(1);
        const [left, right = ""] = value.toLowerCase().split("::");
        const lhs = left ? left.split(":") : [];
        const rhs = right ? right.split(":") : [];
        const missing = 8 - lhs.length - rhs.length;
        if (missing < 0) process.exit(1);
        return [...lhs, ...Array(missing).fill("0"), ...rhs].map((part) => part.padStart(4, "0"));
      };
      if (!isDeepStrictEqual(expand(process.env.EXPECTED_IP), expand(process.env.DETECTED_IP))) process.exit(1);
    ' || fail "VPS IPv6 mismatch: expected $expected_ipv6, detected $detected_ipv6"
  fi
}

validate_network_response() {
  node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let value;
      try { value = JSON.parse(raw); } catch { process.exit(2); }
      const config = value && value.config;
      const validArray = (items) => Array.isArray(items) && items.every((item) => typeof item === "string" && item.length > 0 && !item.includes("\n"));
      if (value.entitlement !== "allowed" || typeof value.status !== "string" || !config ||
          !validArray(config.dbAllowedCidrs) || !validArray(config.dbAllowedCidrsV6)) process.exit(3);
      process.stdout.write(JSON.stringify({
        entitlement: value.entitlement,
        status: value.status,
        config: {
          dbAllowedCidrs: config.dbAllowedCidrs,
          dbAllowedCidrsV6: config.dbAllowedCidrsV6
        }
      }));
    });
  '
}

get_network_response() {
  local raw
  raw="$(run_supabase_cli network-restrictions get \
    --project-ref "$SUPABASE_PROJECT_REF" \
    --experimental \
    --output json)" || fail "could not read Supabase Network Restrictions"
  printf '%s' "$raw" | validate_network_response || fail "unexpected or unauthorized Network Restrictions response"
}

response_status() {
  NETWORK_RESPONSE="$1" node -e 'process.stdout.write(JSON.parse(process.env.NETWORK_RESPONSE).status)'
}

response_config() {
  NETWORK_RESPONSE="$1" node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.env.NETWORK_RESPONSE).config))'
}

canonical_config() {
  CONFIG_JSON="$1" node -e '
    const value = JSON.parse(process.env.CONFIG_JSON);
    const normalize = (items) => [...new Set(items)].sort();
    process.stdout.write(JSON.stringify({
      dbAllowedCidrs: normalize(value.dbAllowedCidrs),
      dbAllowedCidrsV6: normalize(value.dbAllowedCidrsV6)
    }));
  '
}

configs_equal() {
  [[ "$(canonical_config "$1")" == "$(canonical_config "$2")" ]]
}

restricted_config() {
  IPV4_CIDR="$VPS_IPV4_CIDR" IPV6_CIDR="${VPS_IPV6_CIDR:-}" node -e '
    const v6 = process.env.IPV6_CIDR;
    process.stdout.write(JSON.stringify({
      dbAllowedCidrs: [process.env.IPV4_CIDR],
      dbAllowedCidrsV6: v6 ? [v6] : []
    }));
  '
}

write_recovery_file() {
  local config="$1"
  [[ ! -e "$RECOVERY_FILE" ]] || fail "unresolved recovery file already exists: $RECOVERY_FILE"
  [[ "$(CONFIG_JSON="$config" node -e 'const c=JSON.parse(process.env.CONFIG_JSON); process.stdout.write(String(c.dbAllowedCidrs.length + c.dbAllowedCidrsV6.length))')" -gt 0 ]] || \
    fail "empty previous configuration cannot be restored with the documented CLI contract"

  local temp_file
  temp_file="$(mktemp "$STATE_DIR/.stage-network-restrictions.XXXXXX")"
  PROJECT_REF="$SUPABASE_PROJECT_REF" CLI_VERSION="$SUPABASE_CLI_VERSION" CONFIG_JSON="$config" node -e '
    const payload = {
      schemaVersion: 1,
      projectRef: process.env.PROJECT_REF,
      capturedAt: new Date().toISOString(),
      supabaseCliVersion: process.env.CLI_VERSION,
      config: JSON.parse(process.env.CONFIG_JSON)
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  ' > "$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" "$RECOVERY_FILE"
}

read_recovery_config() {
  [[ -f "$RECOVERY_FILE" ]] || fail "recovery file is missing: $RECOVERY_FILE"
  [[ "$(stat -c '%a' "$RECOVERY_FILE")" == "600" ]] || fail "recovery file permissions must be 600"
  PROJECT_REF="$SUPABASE_PROJECT_REF" RECOVERY_PATH="$RECOVERY_FILE" node -e '
    const fs = require("node:fs");
    let value;
    try { value = JSON.parse(fs.readFileSync(process.env.RECOVERY_PATH, "utf8")); } catch { process.exit(2); }
    const config = value && value.config;
    const validArray = (items) => Array.isArray(items) && items.every((item) => typeof item === "string" && item.length > 0 && !item.includes("\n"));
    if (value.schemaVersion !== 1 || value.projectRef !== process.env.PROJECT_REF ||
        value.supabaseCliVersion !== "2.109.1" || !config ||
        !validArray(config.dbAllowedCidrs) || !validArray(config.dbAllowedCidrsV6) ||
        config.dbAllowedCidrs.length + config.dbAllowedCidrsV6.length === 0) process.exit(3);
    process.stdout.write(JSON.stringify(config));
  ' || fail "recovery file is malformed or targets a different project"
}

apply_config() {
  local config="$1"
  local -a cidrs=()
  mapfile -t cidrs < <(CONFIG_JSON="$config" node -e '
    const c = JSON.parse(process.env.CONFIG_JSON);
    for (const item of [...c.dbAllowedCidrs, ...c.dbAllowedCidrsV6]) process.stdout.write(`${item}\n`);
  ')
  [[ "${#cidrs[@]}" -gt 0 ]] || fail "refusing to apply an empty CIDR list"

  local -a args=(network-restrictions update --project-ref "$SUPABASE_PROJECT_REF")
  local cidr
  for cidr in "${cidrs[@]}"; do
    args+=(--db-allow-cidr "$cidr")
  done
  args+=(--experimental --output json)
  run_supabase_cli "${args[@]}" >/dev/null || fail "Network Restrictions update failed; keep WS stopped and use restore"
}

wait_for_config() {
  local expected="$1"
  local started now response status current
  started="$(date +%s)"
  while true; do
    response="$(get_network_response)"
    status="$(response_status "$response")"
    current="$(response_config "$response")"
    if [[ "$status" == "applied" ]] && configs_equal "$current" "$expected"; then
      return 0
    fi
    now="$(date +%s)"
    (( now - started < APPLY_TIMEOUT_SECONDS )) || fail "timed out waiting for status=applied and the exact expected CIDRs"
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

require_ws_inactive() {
  require_command systemctl
  local state
  state="$(systemctl is-active "$WS_SERVICE_NAME" 2>/dev/null || true)"
  [[ "$state" == "inactive" ]] || fail "$WS_SERVICE_NAME must be inactive; current state: ${state:-unknown}"
}

archive_recovery_file() {
  local archived
  archived="$RECOVERY_FILE.restored-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$RECOVERY_FILE" "$archived"
  chmod 600 "$archived"
  printf 'Recovery configuration restored and archived at %s\n' "$archived"
}

command_preflight() {
  [[ ! -e "$RECOVERY_FILE" ]] || fail "unresolved recovery file already exists: $RECOVERY_FILE"
  verify_vps_cidrs
  verify_cli_version
  local response status config
  response="$(get_network_response)"
  status="$(response_status "$response")"
  [[ "$status" == "applied" ]] || fail "current Network Restrictions status is $status, expected applied"
  config="$(response_config "$response")"
  write_recovery_file "$config"
  printf 'NETWORK PREFLIGHT PASSED. Previous configuration saved to %s\n' "$RECOVERY_FILE"
  printf 'No Network Restrictions were modified.\n'
}

command_restrict() {
  require_ws_inactive
  verify_vps_cidrs
  verify_cli_version
  local previous desired response status current
  previous="$(read_recovery_config)"
  desired="$(restricted_config)"
  response="$(get_network_response)"
  status="$(response_status "$response")"
  current="$(response_config "$response")"

  if configs_equal "$current" "$desired"; then
    [[ "$status" == "applied" ]] || wait_for_config "$desired"
    printf 'NETWORK RESTRICTION VERIFIED. Stage Postgres is limited to the VPS CIDRs.\n'
    return
  fi
  configs_equal "$current" "$previous" || fail "current restrictions match neither the saved configuration nor the intended VPS-only configuration"
  [[ "$status" == "applied" ]] || fail "current Network Restrictions status is $status, expected applied"

  apply_config "$desired"
  wait_for_config "$desired"
  printf 'NETWORK RESTRICTION APPLIED. Stage Postgres is limited to the VPS CIDRs.\n'
}

command_status() {
  verify_cli_version
  local response status current desired mode="untracked"
  response="$(get_network_response)"
  status="$(response_status "$response")"
  current="$(response_config "$response")"
  if [[ -n "${VPS_IPV4_CIDR:-}" ]]; then
    validate_cidr 4 "$VPS_IPV4_CIDR"
    if [[ -n "${VPS_IPV6_CIDR:-}" ]]; then validate_cidr 6 "$VPS_IPV6_CIDR"; fi
    desired="$(restricted_config)"
    if configs_equal "$current" "$desired"; then mode="restricted-to-vps"; fi
  fi
  if [[ -f "$RECOVERY_FILE" ]]; then
    local previous
    previous="$(read_recovery_config)"
    if configs_equal "$current" "$previous"; then mode="saved-original"; fi
  fi
  STATUS="$status" MODE="$mode" PROJECT_REF="$SUPABASE_PROJECT_REF" CONFIG_JSON="$current" node -e '
    process.stdout.write(`${JSON.stringify({
      projectRef: process.env.PROJECT_REF,
      status: process.env.STATUS,
      mode: process.env.MODE,
      config: JSON.parse(process.env.CONFIG_JSON)
    }, null, 2)}\n`);
  '
  [[ "$status" == "applied" ]] || fail "Network Restrictions are not applied"
  [[ "$mode" != "untracked" || ! -f "$RECOVERY_FILE" ]] || fail "active recovery exists but current configuration is unexpected"
}

command_restore() {
  require_ws_inactive
  verify_cli_version
  local previous response status current
  previous="$(read_recovery_config)"
  response="$(get_network_response)"
  status="$(response_status "$response")"
  current="$(response_config "$response")"
  if ! configs_equal "$current" "$previous" || [[ "$status" != "applied" ]]; then
    apply_config "$previous"
    wait_for_config "$previous"
  fi
  archive_recovery_file
  printf 'NETWORK RESTORE VERIFIED. Start Netlify/WS only after the remaining runbook recovery gates pass.\n'
}

main() {
  [[ "$#" -eq 1 ]] || { usage >&2; exit 2; }
  require_command node
  require_command flock
  require_command stat
  if [[ -z "${SUPABASE_CLI_BIN:-}" ]]; then require_command npx; fi
  validate_target
  acquire_lock

  case "$1" in
    preflight)
      require_command curl
      command_preflight
      ;;
    restrict)
      require_command curl
      command_restrict
      ;;
    status)
      command_status
      ;;
    restore)
      command_restore
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
