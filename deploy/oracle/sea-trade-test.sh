#!/usr/bin/env bash
# Isolated test deployment only. Does not restart production, reload Caddy,
# write its revision marker, or open a public port.
set -euo pipefail
revision=${1:?full published commit required}
fixture=${2:?absolute fixture envelope .v8 path required}
label=${3:?unique lowercase run label required}
branch=refs/heads/codex/sea-trade-lanes
[[ $EUID -eq 0 && $revision =~ ^[0-9a-f]{40}$ && $label =~ ^[a-z0-9-]{1,48}$ && $fixture == /* && -f $fixture ]] || exit 2
idle() { curl -fsS http://127.0.0.1:8080/healthz | python3 -c 'import sys,json;sys.exit(0 if json.load(sys.stdin)["activeMatches"]==0 else 3)'; }
idle || { echo 'Production busy/unavailable; no test started.' >&2; exit 3; }
[[ -z $(docker ps -q --filter label=ageoffronts.profile=1) ]] || { echo 'Another isolated profile is running.' >&2; exit 3; }
repo=/opt/ageoffronts/repo
published=$(git -C "$repo" ls-remote origin "$branch" | cut -f1)
[[ $published == "$revision" ]] || { echo 'Exact tested commit is not published on the test branch.' >&2; exit 4; }
git -C "$repo" fetch origin "$branch"
root=/opt/ageoffronts/sea-trade-test/$revision
source=$root/source
if [[ ! -d $source ]]; then
  mkdir -p "$root"
  GIT_LFS_SKIP_SMUDGE=1 git -C "$repo" worktree add --detach "$source" "$revision"
fi
[[ $(git -C "$source" rev-parse HEAD) == "$revision" && -z $(git -C "$source" status --porcelain --untracked-files=no) ]] || { echo 'Test source differs from target.' >&2; exit 4; }
git -C "$source" lfs pull --include='resources/**,src/skirmish/client/troops/assets/**,Art/UI Age Themes/**,Art/Runtime/Ages/**,Art/Runtime/Russians/**,Art/Building Markers/**,Art/Building Icons/_prepared/StoneAge/**,Art/Formation Icons/**,Art/Soldier Icons/**,Art/Terrain/**' --exclude=''
docker build --build-arg "SOURCE_REVISION=$revision" -f "$source/deploy/oracle/Dockerfile" -t "ageoffronts-test:$revision" "$source"
mkdir -p "$root/probe-build"
chown 1000:1000 "$root/probe-build"
docker run --rm --network none --memory 2g --pids-limit 128 --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
 --entrypoint node -v "$source/scripts:/usr/src/app/scripts:ro" -v "$root/probe-build:/probe-build" "ageoffronts-test:$revision" scripts/buildOracleSeaTradeProbe.mjs /probe-build
idle || { echo 'New production match; test not started.' >&2; exit 3; }
result=$root/results/$label
[[ ! -e $result ]] || { echo 'Preserve existing evidence; choose a new label.' >&2; exit 4; }
mkdir -p "$result"
chown 1000:1000 "$result"
sha256sum "$fixture" >"$result/input.sha256"
uname -a >"$result/host.txt"
docker image inspect "ageoffronts-test:$revision" --format '{{.Id}}' >"$result/image-id.txt"
container=ageoffronts-sea-test-$label
id=$(docker run -d --name "$container" --label ageoffronts.profile=1 --label "ageoffronts.test.source=$revision" \
 --cpus 2 --memory 4g --pids-limit 128 --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
 --log-opt max-size=20m --log-opt max-file=3 --entrypoint node \
 -e "SEA_PROBE_FIXTURE=/probe-input/fixture.v8" -e SEA_PROBE_OUT=/probe-output -e MULTIPLAYER_DB=/probe-output/probe.sqlite \
 -p 127.0.0.1:18081:8080 -p 127.0.0.1:18082:8081 \
 -v "$fixture:/probe-input/fixture.v8:ro" -v "$root/probe-build:/usr/src/app/probe:ro" -v "$result:/probe-output" \
 "ageoffronts-test:$revision" probe/server.mjs)
printf '%s\n' "$id" >"$result/container-id.txt"
# The guard only stops this named test. It yields the machine if a real match
# starts, and caps an abandoned test at one hour. Production is never stopped.
nohup bash -c '
 deadline=$((SECONDS+3600))
 while [[ $(docker inspect -f "{{.State.Running}}" "$1" 2>/dev/null) == true ]]; do
  if (( SECONDS>=deadline )) || ! curl -fsS http://127.0.0.1:8080/healthz | python3 -c '\''import sys,json;sys.exit(0 if json.load(sys.stdin)["activeMatches"]==0 else 3)'\''; then
   echo "Stopping isolated test: production activity, unavailable health, or one-hour deadline."
   docker stop "$1"; exit
  fi
  sleep 5
 done' guard "$container" >"$result/guard.log" 2>&1 </dev/null &
printf '%s\n' "$!" >"$result/guard.pid"
echo "Isolated test: $container; evidence: $result"
echo 'Forward local ports 18081 and 18082 with SSH, then run the published client probe.'
