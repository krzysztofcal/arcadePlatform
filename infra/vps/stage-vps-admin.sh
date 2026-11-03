#!/usr/bin/env bash
set -Eeuo pipefail

# Installs only the VPS admin helper, the arcade-admin account and its sudoers contract (#1159 root on demand).
# Runs as root on an existing host instead of the full bootstrap. It adds no SSH key (a separate owner step), never
# restarts services and runs no mutating admin operation: the only verification is the read-only status operation.
if [[ "$EUID" -ne 0 ]]; then
  echo "stage-vps-admin must run as root" >&2
  exit 1
fi

REPO_ROOT="${ARCADEPLATFORM_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HELPER_SRC="$REPO_ROOT/infra/vps/vps-admin.mjs"
HELPER_DEST="/usr/local/sbin/arcade-vps-admin"
SUDOERS_SRC="$REPO_ROOT/infra/vps/arcade-admin.sudoers"
SUDOERS_DEST="/etc/sudoers.d/arcade-admin"

for required in "$HELPER_SRC" "$SUDOERS_SRC" /usr/bin/node /usr/bin/logger; do
  if [[ ! -e "$required" || -L "$required" ]]; then
    echo "refusing staging: missing or symlinked prerequisite: $required" >&2
    exit 1
  fi
done
if ! visudo -cf "$SUDOERS_SRC"; then
  echo "refusing staging: invalid arcade admin sudoers contract in repository" >&2
  exit 1
fi

# The admin account must not share a group with the agent account copilot.
getent group arcade-admin >/dev/null || groupadd --system arcade-admin
id arcade-admin >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/arcade-admin --shell /bin/bash --gid arcade-admin arcade-admin
refuse() { echo "refusing staging: $*" >&2; exit 1; }
if id -nG copilot | tr ' ' '\n' | grep -qx arcade-admin; then refuse "copilot is a member of arcade-admin"; fi
# An already existing account must be exactly the reviewed one; it is never repaired silently.
(( "$(id -u arcade-admin)" < 1000 )) || refuse "arcade-admin is not a system account"
[[ "$(id -nG arcade-admin)" == "arcade-admin" ]] || refuse "arcade-admin must belong only to its own group"
[[ -z "$(getent group arcade-admin | cut -d: -f4)" ]] || refuse "group arcade-admin must have no other members"
[[ "$(getent passwd arcade-admin | cut -d: -f6-7)" == "/home/arcade-admin:/bin/bash" ]] || refuse "unexpected arcade-admin home or shell"
for entry in /home/arcade-admin /home/arcade-admin/.ssh /home/arcade-admin/.ssh/authorized_keys; do
  [[ -e "$entry" ]] || continue
  [[ ! -L "$entry" && "$(stat -c %U:%G "$entry")" == "arcade-admin:arcade-admin" ]] || refuse "$entry must be owned by arcade-admin and not a symlink"
  (( (8#$(stat -c %a "$entry") & 8#022) == 0 )) || refuse "$entry must not be group or other writable"
done
install -d -o arcade-admin -g arcade-admin -m 0700 /home/arcade-admin/.ssh

install -D -o root -g root -m 0755 "$HELPER_SRC" "$HELPER_DEST"
install -o root -g root -m 0440 "$SUDOERS_SRC" "$SUDOERS_DEST"
visudo -c
# The account's only sudo rights are the helper operations.
# Every listed command (after the run-as spec and tags, comma separated) must be the helper with an operation.
EXTRA_SUDO="$(sudo -l -U arcade-admin | sed -n '/may run the following commands/,$p' | tail -n +2 \
  | sed -E 's/^[[:space:]]*\([^)]*\)[[:space:]]*([A-Z_]+:[[:space:]]*)*//' | tr ',' '\n' | sed -E 's/^[[:space:]]+//' \
  | grep -v '^$' | grep -Ev '^/usr/local/sbin/arcade-vps-admin [a-z0-9-]+ \*$' || true)"
[[ -z "$EXTRA_SUDO" ]] || refuse "arcade-admin has sudo rights beyond /usr/local/sbin/arcade-vps-admin operations"

STATUS="$(sudo -u arcade-admin sudo -n "$HELPER_DEST" ledger-dispatchers-status 1 || true)"
if [[ "$STATUS" != "ADMIN_OK ledger-dispatchers-status "* ]]; then
  echo "stage-vps-admin: status verification failed: '$STATUS'" >&2
  exit 1
fi
if sudo -u copilot sudo -n -l "$HELPER_DEST" ledger-dispatchers-status 1 >/dev/null 2>&1; then
  echo "stage-vps-admin: copilot can run the admin helper" >&2
  exit 1
fi
echo "stage-vps-admin: OK ($STATUS)"
