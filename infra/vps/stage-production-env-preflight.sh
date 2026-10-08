#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "stage-production-env-preflight must run as root" >&2
  exit 1
fi

REPO_ROOT="${ARCADEPLATFORM_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

HELPER_SRC="$REPO_ROOT/infra/vps/ws-production-env-preflight.mjs"
HELPER_DEST="/usr/local/sbin/arcade-ws-production-env-preflight"
SUDOERS_SRC="$REPO_ROOT/infra/vps/arcade-deploy.sudoers"
SUDOERS_DEST="/etc/sudoers.d/arcade-deploy"
PROD_ENV="/etc/arcadeplatform/ws-server.env"

# 1. Prerequisite checks on the existing host
if [[ ! -f "$PROD_ENV" || -L "$PROD_ENV" ]]; then
  echo "refusing staging: missing or invalid production env: $PROD_ENV" >&2
  exit 1
fi

if [[ ! -x /usr/bin/node ]]; then
  echo "refusing staging: missing /usr/bin/node interpreter" >&2
  exit 1
fi

if [[ ! -x /usr/bin/psql ]]; then
  echo "refusing staging: missing /usr/bin/psql client" >&2
  exit 1
fi

if [[ ! -f "$HELPER_SRC" ]]; then
  echo "refusing staging: missing helper source: $HELPER_SRC" >&2
  exit 1
fi

if [[ ! -f "$SUDOERS_SRC" ]]; then
  echo "refusing staging: missing sudoers source: $SUDOERS_SRC" >&2
  exit 1
fi

# 2. Validate sudoers contract before touching anything
if ! visudo -cf "$SUDOERS_SRC"; then
  echo "refusing staging: invalid arcade deploy sudoers contract in repository" >&2
  exit 1
fi

# 3. Install the root-owned helper
install -D -o root -g root -m 0755 "$HELPER_SRC" "$HELPER_DEST"

# 4. Install updated sudoers contract
install -o root -g root -m 0440 "$SUDOERS_SRC" "$SUDOERS_DEST"
visudo -c

# 5. Read-only verification before activation: run as copilot via sudo
PREFLIGHT_OUTPUT="$(sudo -u copilot sudo -n "$HELPER_DEST")"
if [[ "$PREFLIGHT_OUTPUT" != "PASS" ]]; then
  echo "stage-production-env-preflight: read-only verification failed: expected PASS, got '$PREFLIGHT_OUTPUT'" >&2
  exit 1
fi

echo "stage-production-env-preflight: OK (helper installed, sudoers active, preflight verified PASS)"
