#!/usr/bin/env bash
set -Eeuo pipefail

# Installs only the WS restart gate, its root-only hold directory and the deploy sudoers contract.
# Runs as root on an existing host instead of the full bootstrap. Never restarts or reloads services.
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

for required in "$HELPER_SRC" "$SUDOERS_SRC" /usr/bin/node /usr/bin/psql /etc/arcadeplatform/ws-server.env; do
  if [[ ! -e "$required" || -L "$required" ]]; then
    echo "refusing staging: missing or symlinked prerequisite: $required" >&2
    exit 1
  fi
done

if ! visudo -cf "$SUDOERS_SRC"; then
  echo "refusing staging: invalid arcade deploy sudoers contract in repository" >&2
  exit 1
fi

install -D -o root -g root -m 0755 "$HELPER_SRC" "$HELPER_DEST"
install -d -o root -g root -m 0755 "$HOLD_DIR"
install -o root -g root -m 0440 "$SUDOERS_SRC" "$SUDOERS_DEST"
visudo -c

# Read-only verification as the deploy account: the gate must answer with one decision line.
GATE_OUTPUT="$(sudo -u copilot sudo -n "$HELPER_DEST" check || true)"
if [[ ! "$GATE_OUTPUT" =~ ^RESTART_(SAFE|BLOCKED) ]]; then
  echo "stage-ws-restart-gate: verification failed: '$GATE_OUTPUT'" >&2
  exit 1
fi
echo "stage-ws-restart-gate: OK ($GATE_OUTPUT)"
