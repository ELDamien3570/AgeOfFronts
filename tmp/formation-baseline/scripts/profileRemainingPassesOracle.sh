#!/usr/bin/env bash
set -euo pipefail
variant=${1:?baseline or current}
label=${2:?result label}
mode=${3:-dense}
[[ "$variant" == baseline || "$variant" == current ]] || exit 2
[[ "$label" =~ ^[a-z0-9-]+$ ]] || exit 2
root=/home/ubuntu/perf-12
idle() { curl -fsS http://127.0.0.1:8080/healthz | python3 -c 'import json,sys;sys.exit(0 if json.load(sys.stdin)["activeMatches"]==0 else 3)'; }
idle || { echo "Skipped: production match active"; exit 3; }
[[ -z $(sudo docker ps -q --filter label=ageoffronts.profile=1) ]] || { echo "Skipped: another isolated profile is running"; exit 3; }
image=$(sudo docker inspect ageoffronts-app-1 --format '{{.Config.Image}}')
mkdir -p "$root/results/$label"
chmod 777 "$root/results/$label"
case "$mode" in
  dense) command=(scripts/profileSkirmishStability.mjs --restore /benchmark/input/oldworld-50.v8 --map old-world --size 1000 --humans 2 --all-ai --inspect-churn --inspect-ai --worker-encoding --ticks 62400 --profile-at 60000 --max-seconds 900 --out "/benchmark/results/$label"); result=summary.json ;;
  latency) command=(scripts/profileV11LateLatency.mjs --restore /benchmark/input/oldworld-50.v8 --map old-world --size 1000 --count 30 --trials 4 --out "/benchmark/results/$label/result.json"); result=result.json ;;
  transport) command=(scripts/profileV11LateLatency.mjs --restore /benchmark/input/oldworld-50.v8 --map old-world --size 1000 --count 30 --trials 4 --transport --follow-through --out "/benchmark/results/$label/result.json"); result=result.json ;;
  movement) command=(scripts/profileV11Movement.mjs --bounded-orders --out "/benchmark/results/$label/result.json"); result=result.json ;;
  combat) command=(scripts/profileCombatApproaches.mjs --out "/benchmark/results/$label/result.json"); result=result.json ;;
  hosted) command=(scripts/runHostedStabilitySoak.mjs --seconds 3600 --out "/benchmark/results/$label"); result=smoke.json ;;
  *) exit 2 ;;
esac
container=$(sudo docker run -d --rm --label ageoffronts.profile=1 --network none --cpus 2 --memory 2g --pids-limit 128 --read-only --tmpfs /tmp --user 1001:1001 \
  --entrypoint node -v "$root/$variant/src:/usr/src/app/src:ro" -v "$root/current/scripts:/usr/src/app/scripts:ro" \
  -v /home/ubuntu/perf-v11/input:/benchmark/input:ro -v "$root/results:/benchmark/results" "$image" --import tsx "${command[@]}")
trap 'sudo docker stop "$container" >/dev/null 2>&1 || true' EXIT
while sudo docker inspect "$container" >/dev/null 2>&1; do
  if ! idle; then echo "Stopped: new production match"; exit 3; fi
  sudo docker logs "$container" > "$root/results/$label/console.log" 2>&1 || true
  sleep 10
done
test -s "$root/results/$label/$result"
cat "$root/results/$label/$result"
