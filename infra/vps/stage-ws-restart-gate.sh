#!/usr/bin/env bash
set -Eeuo pipefail

# Installs only the WS restart gate, its root-only hold directory, the hold drop-in and the deploy sudoers
# contract. Runs as root on an existing host instead of the full bootstrap. Never restarts services; the
# drop-in takes effect at the next WS start. The attested production env file is never modified.
if [[ "$EUID" -ne 0 ]]; then
  echo "stage-ws-restart-gate must run as root" >&2
  exit 1
fi

REPO_ROOT="${ARCADEPLATFORM_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HELPER_SRC="$REPO_ROOT/infra/vps/ws-restart-gate.mjs"
HELPER_DEST="/usr/local/sbin/arcade-ws-restart-gate"
SUDOERS_SRC="$REPO_ROOT/infra/vps/arcade-deploy.sudoers"
SUDOERS_DEST="/etc/sudoers.d/arcade-deploy"
HOLD_DIR="/etc/arcadeplatform/ws-hold"
DROPIN_SRC="$REPO_ROOT/infra/vps/ws-server.service.d/50-new-hands-hold.conf"
DROPIN_DEST="/etc/systemd/system/ws-server.service.d/50-new-hands-hold.conf"
PROD_ENV="/etc/arcadeplatform/ws-server.env"

for required in "$HELPER_SRC" "$SUDOERS_SRC" "$DROPIN_SRC" /usr/bin/node "$PROD_ENV"; do
  if [[ ! -e "$required" || -L "$required" ]]; then
    echo "refusing staging: missing or symlinked prerequisite: $required" >&2
    exit 1
  fi
done

# Ubuntu ships /usr/bin/psql as a symlink to pg_wrapper: accept it only when the link's directory, the resolved
# executable and that executable's directory are all root-owned and not writable by group or others.
trusted_root_executable() {
  local target entry mode
  target="$(readlink -e -- "$1")" || return 1
  [[ -f "$target" && -x "$target" ]] || return 1
  for entry in "$(readlink -e -- "$(dirname -- "$1")")" "$target" "$(dirname -- "$target")"; do
    [[ -n "$entry" && "$(stat -c '%u:%g' -- "$entry")" == "0:0" ]] || return 1
    mode="$(stat -c '%a' -- "$entry")"
    (( (8#$mode & 8#022) == 0 )) || return 1
  done
}

if ! trusted_root_executable /usr/bin/psql; then
  echo "refusing staging: /usr/bin/psql does not resolve to a root-owned, non-writable executable" >&2
  exit 1
fi

# EnvironmentFile= would override the drop-in; the attested env must not carry the hold variable.
if grep -q '^WS_POKER_NEW_HANDS_HOLD_FILE=' "$PROD_ENV"; then
  echo "refusing staging: production env defines WS_POKER_NEW_HANDS_HOLD_FILE; it must come from the drop-in" >&2
  exit 1
fi

if ! visudo -cf "$SUDOERS_SRC"; then
  echo "refusing staging: invalid arcade deploy sudoers contract in repository" >&2
  exit 1
fi

install -D -o root -g root -m 0755 "$HELPER_SRC" "$HELPER_DEST"
install -d -o root -g root -m 0755 "$HOLD_DIR"
install -D -o root -g root -m 0644 "$DROPIN_SRC" "$DROPIN_DEST"
systemctl daemon-reload
if [[ "$(systemctl show ws-server.service -p Environment --value)" != *"WS_POKER_NEW_HANDS_HOLD_FILE=$HOLD_DIR/new-hands"* ]]; then
  echo "stage-ws-restart-gate: drop-in not visible in the ws-server.service environment" >&2
  exit 1
fi
install -o root -g root -m 0440 "$SUDOERS_SRC" "$SUDOERS_DEST"
visudo -c

# Read-only verification as the deploy account: the gate must answer with one decision line.
GATE_OUTPUT="$(sudo -u copilot sudo -n "$HELPER_DEST" check || true)"
if [[ ! "$GATE_OUTPUT" =~ ^RESTART_(SAFE|BLOCKED) ]]; then
  echo "stage-ws-restart-gate: verification failed: '$GATE_OUTPUT'" >&2
  exit 1
fi
echo "stage-ws-restart-gate: OK ($GATE_OUTPUT)"
