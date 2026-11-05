#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${ARCADEPLATFORM_BOOTSTRAP_TARGET:-}" != "fresh-vps" ]]; then
  echo "refusing bootstrap: set ARCADEPLATFORM_BOOTSTRAP_TARGET=fresh-vps on a fresh server" >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "bootstrap must run as root" >&2
  exit 1
fi

for existing_marker in \
  /etc/arcadeplatform/ws-server.env \
  /opt/ws-server/current \
  /opt/arcade-ws-preview/.env.preview; do
  if [[ -e "$existing_marker" || -L "$existing_marker" ]]; then
    echo "refusing bootstrap: existing runtime marker $existing_marker; use a fresh VPS" >&2
    exit 1
  fi
done

REPO_ROOT="${ARCADEPLATFORM_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

if [[ ! -r /etc/os-release ]]; then
  echo "missing /etc/os-release" >&2
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "supported platform: Ubuntu 24.04 LTS" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

caddy_runtime_masked=0
trap 'if [[ "$caddy_runtime_masked" -eq 1 ]]; then systemctl unmask caddy.service; fi' EXIT
systemctl mask --runtime caddy.service
caddy_runtime_masked=1

apt-get update
apt-get install -y \
  age \
  ca-certificates \
  caddy \
  curl \
  git \
  gh \
  gzip \
  libgcc-s1 \
  libicu74 \
  libkrb5-3 \
  libssl3t64 \
  openssh-server \
  openssl \
  postgresql-client \
  rsync \
  sudo \
  tar \
  ufw \
  unzip \
  zlib1g

systemctl unmask caddy.service
caddy_runtime_masked=0
trap - EXIT
systemctl disable caddy.service >/dev/null 2>&1 || true

node_major=""
if [[ -x /usr/bin/node ]]; then
  node_major="$(/usr/bin/node --version | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p')"
fi
if [[ "$node_major" != "20" ]]; then
  curl --fail --silent --show-error --location https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if [[ ! -x /usr/bin/node ]]; then
  echo "required fixed Node interpreter /usr/bin/node is missing" >&2
  exit 1
fi

node_major="$(/usr/bin/node --version | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p')"
if [[ "$node_major" != "20" ]]; then
  echo "Node.js 20 is required; found $(/usr/bin/node --version)" >&2
  exit 1
fi

getent group arcade >/dev/null || groupadd --system arcade
id arcade >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/arcade --shell /bin/bash --gid arcade arcade

id copilot >/dev/null 2>&1 || useradd --create-home --home-dir /home/copilot --shell /bin/bash copilot

getent group wslogs >/dev/null || groupadd --system wslogs
usermod --append --groups wslogs arcade
usermod --append --groups wslogs copilot

getent group arcade-deploy >/dev/null || groupadd --system arcade-deploy
usermod --append --groups arcade-deploy copilot
gpasswd --delete arcade arcade-deploy >/dev/null 2>&1 || true

# WS Production release account: reachable only with the ws-production environment key (#1159 T004).
# It owns the Production release tree; the agent account copilot is never a member of its group.
getent group arcade-release >/dev/null || groupadd --system arcade-release
id arcade-release >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/arcade-release --shell /bin/bash --gid arcade-release arcade-release
gpasswd --delete copilot arcade-release >/dev/null 2>&1 || true
install -d -o arcade-release -g arcade-release -m 0700 /home/arcade-release/.ssh

# VPS admin account: reachable only with the vps-admin environment key; runs only the admin helper's catalog.
getent group arcade-admin >/dev/null || groupadd --system arcade-admin
id arcade-admin >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/arcade-admin --shell /bin/bash --gid arcade-admin arcade-admin
gpasswd --delete copilot arcade-admin >/dev/null 2>&1 || true
install -d -o arcade-admin -g arcade-admin -m 0700 /home/arcade-admin/.ssh

# Ledger dispatchers: owner Actions tokens only from root-owned 0600 env files (#1159 T004-3).
# No login, no home and no group shared with the agent account copilot.
getent group arcade-dispatch >/dev/null || groupadd --system arcade-dispatch
id arcade-dispatch >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid arcade-dispatch arcade-dispatch
gpasswd --delete copilot arcade-dispatch >/dev/null 2>&1 || true

getent group arcade-stage-runner >/dev/null || groupadd --system arcade-stage-runner
id arcade-stage-runner >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /var/lib/arcade-stage-runner --shell /usr/sbin/nologin --gid arcade-stage-runner arcade-stage-runner

install -d -o root -g root -m 0755 /etc/arcadeplatform
# New hosts only: an existing host moves /opt/ws-server through the reviewed ownership migration
# (specs/1159-ci-cd-release-safety/t004/plan.md), never by re-running this script.
install -d -o root -g arcade-release -m 2775 /opt/ws-server /opt/ws-server/releases
install -o arcade-release -g arcade-release -m 0660 /dev/null /opt/ws-server/.deploy-maintenance.lock
install -d -o arcade -g arcade -m 0755 /opt/arcade-ws-preview
install -d -o root -g arcade-deploy -m 2775 \
  /opt/arcade-ws-preview/ws-server \
  /opt/arcade-ws-preview/shared \
  /opt/arcade-ws-preview/netlify \
  /opt/arcade-ws-preview/node_modules
install -d -o copilot -g copilot -m 0755 /home/copilot/.local/bin
install -d -o copilot -g copilot -m 0700 /home/copilot/.config/gh
install -d -o arcade-stage-runner -g arcade-stage-runner -m 0750 /var/lib/arcade-stage-runner
install -d -o arcade-stage-runner -g arcade-stage-runner -m 0755 /var/lib/arcade-stage-runner/actions-runner
install -d -o arcade-stage-runner -g arcade-stage-runner -m 0700 /var/lib/arcade-stage-runner/actions-runner/_work

if [[ ! -x /home/copilot/.local/bin/gh ]]; then
  install -o copilot -g copilot -m 0755 "$(command -v gh)" /home/copilot/.local/bin/gh
fi

install -d -o root -g root -m 0755 /etc/caddy
install -o root -g arcade-deploy -m 0664 "$REPO_ROOT/infra/vps/Caddyfile" /etc/caddy/Caddyfile

install -D -o root -g root -m 0755 \
  "$REPO_ROOT/infra/vps/ws-preview-env-preflight.mjs" \
  /usr/local/sbin/arcade-ws-preview-env-preflight

install -D -o root -g root -m 0755 \
  "$REPO_ROOT/infra/vps/ws-production-env-preflight.mjs" \
  /usr/local/sbin/arcade-ws-production-env-preflight

install -D -o root -g root -m 0755 \
  "$REPO_ROOT/infra/vps/ws-restart-gate.mjs" \
  /usr/local/sbin/arcade-ws-restart-gate
install -d -o root -g root -m 0755 /etc/arcadeplatform/ws-hold

if ! visudo -cf "$REPO_ROOT/infra/vps/arcade-deploy.sudoers"; then
  echo "refusing bootstrap: invalid arcade deploy sudoers contract" >&2
  exit 1
fi
install -o root -g root -m 0440 \
  "$REPO_ROOT/infra/vps/arcade-deploy.sudoers" \
  /etc/sudoers.d/arcade-deploy
visudo -c

# Fixed Preview isolation catalog dependencies; installing these does not provision Preview.
for directory in /usr/local/libexec /usr/local/libexec/arcade-vps-admin /var/lib/arcade-admin; do
  if [[ -e "$directory" || -L "$directory" ]]; then
    [[ -d "$directory" && ! -L "$directory" && "$(stat -c %U:%G "$directory")" == root:root ]] || exit 1
    (( (8#$(stat -c %a "$directory") & 8#022) == 0 )) || exit 1
  fi
done
install -d -o root -g root -m 0755 /usr/local/libexec/arcade-vps-admin
install -d -o root -g root -m 0700 /var/lib/arcade-admin
for asset in ws-preview-isolation.py prepare-ws-preview-v3.py ws-preview-owner.pub; do
  test -f "$REPO_ROOT/infra/vps/$asset" && test ! -L "$REPO_ROOT/infra/vps/$asset" || exit 1
  install -o root -g root -m 0644 "$REPO_ROOT/infra/vps/$asset" "/usr/local/libexec/arcade-vps-admin/$asset"
done
install -d -o root -g root -m 0755 /usr/local/libexec/arcade-vps-admin/ws-server-preview.service.d
install -o root -g root -m 0644 "$REPO_ROOT/infra/vps/ws-server-preview.service.d/99-preview-isolation.conf" /usr/local/libexec/arcade-vps-admin/ws-server-preview.service.d/99-preview-isolation.conf

install -D -o root -g root -m 0755 "$REPO_ROOT/infra/vps/vps-admin.mjs" /usr/local/sbin/arcade-vps-admin
if ! visudo -cf "$REPO_ROOT/infra/vps/arcade-admin.sudoers"; then
  echo "refusing bootstrap: invalid arcade admin sudoers contract" >&2
  exit 1
fi
install -o root -g root -m 0440 "$REPO_ROOT/infra/vps/arcade-admin.sudoers" /etc/sudoers.d/arcade-admin
visudo -c

install -d -o root -g root -m 0755 /etc/sysctl.d
install -o root -g root -m 0644 /dev/stdin /etc/sysctl.d/99-arcadeplatform-ipv6.conf <<'EOF'
net.ipv6.conf.all.disable_ipv6=0
net.ipv6.conf.default.disable_ipv6=0
EOF
sysctl --system >/dev/null

if [[ -f /etc/default/ufw ]]; then
  sed -i -E 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
else
  install -o root -g root -m 0644 /dev/stdin /etc/default/ufw <<'EOF'
IPV6=yes
EOF
fi
ufw default deny incoming
ufw default allow outgoing
ufw default deny routed
ufw logging low
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 3000/tcp
ufw --force enable

install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/ws-server.service" /etc/systemd/system/ws-server.service
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/ws-server.service.d/override.conf" /etc/systemd/system/ws-server.service.d/override.conf
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/ws-server.service.d/50-new-hands-hold.conf" /etc/systemd/system/ws-server.service.d/50-new-hands-hold.conf
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/ws-server-preview.service.example" /etc/systemd/system/ws-server-preview.service
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/arcade-chips-ledger-dispatch.service" /etc/systemd/system/arcade-chips-ledger-dispatch.service
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/arcade-chips-ledger-dispatch.timer" /etc/systemd/system/arcade-chips-ledger-dispatch.timer
install -D -o root -g root -m 0755 "$REPO_ROOT/infra/vps/arcade-chips-ledger-dispatch.sh" /usr/local/bin/arcade-chips-ledger-dispatch.sh
install -D -o root -g root -m 0755 \
  "$REPO_ROOT/infra/vps/vps-maintenance.sh" \
  /usr/local/sbin/arcadeplatform-vps-maintenance.sh
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/arcadeplatform-vps-maintenance.service" /etc/systemd/system/arcadeplatform-vps-maintenance.service
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/arcadeplatform-vps-maintenance.timer" /etc/systemd/system/arcadeplatform-vps-maintenance.timer
systemctl daemon-reload

cat <<'NOTICE'
Bootstrap prepared the fresh Ubuntu VPS. It did not restore secret env files,
register the GitHub runner, enable/start WS services, or enable/start the Stage
scheduler. It did not run VPS maintenance or enable/start its timer. Caddy was
left disabled and unstarted after its package installation;
follow docs/vps-disaster-recovery.md for the owner-approved activation and
recovery sequence. Bootstrap does not perform the separate post-merge live-VPS
cleanup procedure.
NOTICE
