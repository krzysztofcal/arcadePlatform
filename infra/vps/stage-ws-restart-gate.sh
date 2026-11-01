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

for required in "$HELPER_SRC" "$SUDOERS_SRC" "$DROPIN_SRC" /usr/bin/node /usr/bin/psql "$PROD_ENV"; do
  if [[ ! -e "$required" || -L "$required" ]]; then
    echo "refusing staging: missing or symlinked prerequisite: $required" >&2
    exit 1
  fi
done

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
