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
if command -v node >/dev/null 2>&1; then
  node_major="$(node --version | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p')"
fi
if [[ "$node_major" != "20" ]]; then
  curl --fail --silent --show-error --location https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

node_major="$(node --version | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p')"
if [[ "$node_major" != "20" ]]; then
  echo "Node.js 20 is required; found $(node --version)" >&2
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

getent group arcade-stage-runner >/dev/null || groupadd --system arcade-stage-runner
id arcade-stage-runner >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /var/lib/arcade-stage-runner --shell /usr/sbin/nologin --gid arcade-stage-runner arcade-stage-runner

install -d -o root -g root -m 0755 /etc/arcadeplatform
install -d -o root -g root -m 0755 /opt/ws-server /opt/ws-server/releases
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
install -o root -g root -m 0644 "$REPO_ROOT/infra/vps/Caddyfile" /etc/caddy/Caddyfile

install -D -o root -g root -m 0755 \
  "$REPO_ROOT/infra/vps/ws-preview-env-preflight.mjs" \
  /usr/local/sbin/arcade-ws-preview-env-preflight

if ! visudo -cf "$REPO_ROOT/infra/vps/arcade-deploy.sudoers"; then
  echo "refusing bootstrap: invalid arcade deploy sudoers contract" >&2
  exit 1
fi
install -o root -g root -m 0440 \
  "$REPO_ROOT/infra/vps/arcade-deploy.sudoers" \
  /etc/sudoers.d/arcade-deploy
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
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/ws-server-preview.service.example" /etc/systemd/system/ws-server-preview.service
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/arcade-chips-ledger-dispatch.service" /etc/systemd/system/arcade-chips-ledger-dispatch.service
install -D -o root -g root -m 0644 "$REPO_ROOT/infra/vps/arcade-chips-ledger-dispatch.timer" /etc/systemd/system/arcade-chips-ledger-dispatch.timer
install -D -o root -g root -m 0755 "$REPO_ROOT/infra/vps/arcade-chips-ledger-dispatch.sh" /usr/local/bin/arcade-chips-ledger-dispatch.sh
systemctl daemon-reload

cat <<'NOTICE'
Bootstrap prepared the fresh Ubuntu VPS. It did not restore secret env files,
register the GitHub runner, enable/start WS services, or enable/start the Stage
scheduler. Caddy was left disabled and unstarted after its package installation;
follow docs/vps-disaster-recovery.md for the owner-approved activation and
recovery sequence.
NOTICE
