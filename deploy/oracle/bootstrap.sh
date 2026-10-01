#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then
  echo "Run with sudo on Ubuntu 24.04." >&2
  exit 1
fi
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]]
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git git-lfs sqlite3 cron unattended-upgrades
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker cron
install -d -m 0755 /opt/ageoffronts
install -d -m 0700 -o 1000 -g 1000 /opt/ageoffronts/data
install -d -m 0700 /opt/ageoffronts/backups
git lfs install --system
echo "Bootstrap complete. Deploy a tested commit using deploy/oracle/release.sh."
