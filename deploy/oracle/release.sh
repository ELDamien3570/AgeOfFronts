#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Usage: sudo bash release.sh FULL_GIT_COMMIT}
phase=${2:-production}
[[ "$phase" == staging || "$phase" == production ]] || { echo "Phase must be staging or production." >&2; exit 1; }
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo "Use a full Git commit." >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
export SOURCE_REVISION="$revision"
root=/opt/ageoffronts
repo="$root/repo"
if [[ ! -d "$repo/.git" ]]; then
  GIT_LFS_SKIP_SMUDGE=1 git clone --filter=blob:none https://github.com/ELDamien3570/AgeOfFronts.git "$repo"
fi
git -C "$repo" fetch origin
GIT_LFS_SKIP_SMUDGE=1 git -C "$repo" checkout --detach "$revision"
# Artwork and map binaries are Git LFS objects. Avoid fetching the art working
# library, which is not required for a deployed game.
git -C "$repo" lfs pull --include='resources/**,Art/UI Age Themes/**,Art/Runtime/Ages/**,Art/Building Markers/**,Art/Building Icons/_prepared/StoneAge/**,Art/Formation Icons/**,Art/Soldier Icons/**,Art/Terrain/**' --exclude=''
cd "$repo"
compose=(docker compose -f deploy/oracle/compose.yml)
"${compose[@]}" build app
# Build first; never interrupt a match for a build that may fail.
if curl --fail --silent http://127.0.0.1:8080/healthz >"$root/health-before.json"; then
  if ! docker exec -i ageoffronts-app-1 node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(h.activeMatches!==0)process.exit(1)" <"$root/health-before.json"; then
    echo "Active matches exist. Wait for them to finish before deploying." >&2
    exit 1
  fi
fi
bash deploy/oracle/backup.sh
install -m 0755 deploy/oracle/backup.sh /etc/cron.daily/ageoffronts-sqlite
proxy_config=deploy/oracle/Caddyfile
[[ "$phase" == staging ]] && proxy_config=deploy/oracle/Caddyfile.staging
install -m 0644 "$proxy_config" "$root/Caddyfile"
"${compose[@]}" up -d --wait --wait-timeout 180
docker exec ageoffronts-proxy-1 caddy reload --config /etc/caddy/Caddyfile
printf '%s\n' "$revision" >"$root/current-revision"
curl --fail --silent --show-error http://127.0.0.1:8080/healthz
echo
echo "Release $revision started. Verify website, WSS, maps and a match before DNS cutover."
