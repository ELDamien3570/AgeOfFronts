#!/usr/bin/env bash
set -euo pipefail
variant=${1:?stable or current}
label=${2:?result label}
cores=${3:-2}
mode=${4:-replay}
case "$variant" in stable|current) ;; *) exit 2;; esac
[[ "$label" =~ ^[a-z0-9-]+$ ]] || exit 2
root=/home/ubuntu/perf-v11
health=$(curl -fsS http://127.0.0.1:8080/healthz)
[[ "$health" == *'"activeMatches":0'* ]] || { echo "Benchmark skipped: live match"; exit 3; }
image=$(sudo docker inspect ageoffronts-app-1 --format '{{.Config.Image}}')
mkdir -p "$root/results/$label"
mounts=(-v "$root/current/scripts:/usr/src/app/scripts:ro" -v "$root/input:/benchmark/input:ro" -v "$root/results:/benchmark/results")
if [[ "$variant" == current ]]; then mounts+=(-v "$root/current/src:/usr/src/app/src:ro"); fi
case "$mode" in
  replay) command=(scripts/profileSkirmishStability.mjs --restore /benchmark/input/checkpoint-final.v8 --map valles-kairulia --size 500 --all-ai --ticks 50400 --profile-at 48000 --max-seconds 600 --out "/benchmark/results/$label"); result=summary.json ;;
  latency) command=(scripts/profileV11LateLatency.mjs --restore /benchmark/input/checkpoint-final.v8 --out "/benchmark/results/$label/result.json"); result=result.json ;;
  transport) command=(scripts/profileV11LateLatency.mjs --transport --follow-through --restore /benchmark/input/checkpoint-final.v8 --out "/benchmark/results/$label/result.json"); result=result.json ;;
  movement) command=(scripts/profileV11Movement.mjs --out "/benchmark/results/$label/result.json"); result=result.json ;;
  retarget) command=(scripts/profileV11Retargeting.mjs --out "/benchmark/results/$label/result.json"); result=result.json ;;
  oldworld) command=(scripts/profileSkirmishStability.mjs --restore /benchmark/input/oldworld-50.v8 --map old-world --size 1000 --humans 2 --all-ai --inspect-churn --ticks 62400 --profile-at 60000 --max-seconds 900 --out "/benchmark/results/$label");
    [[ "$variant" == stable ]] && command+=(--filter-stale-transport-candidates)
    result=summary.json ;;
  oldworld-latency) command=(scripts/profileV11LateLatency.mjs --restore /benchmark/input/oldworld-50.v8 --map old-world --size 1000 --count 30 --out "/benchmark/results/$label/result.json"); result=result.json ;;
  hosted-soak) command=(scripts/runHostedStabilitySoak.mjs --seconds 2400 --out "/benchmark/results/$label"); result=smoke.json ;;
  heavy-encoding) command=(scripts/profileSkirmishStability.mjs --restore /benchmark/input/oldworld-50.v8 --map old-world --size 1000 --humans 2 --all-ai --inspect-churn --worker-encoding --ticks 72000 --profile-at 60000 --max-seconds 1200 --out "/benchmark/results/$label"); result=summary.json ;;
  radius) command=(scripts/profileRadiusScan.mjs --restore /benchmark/input/oldworld-50.v8 --out "/benchmark/results/$label/result.json"); result=result.json ;;
  queries) command=(scripts/profileQueryReuse.mjs --compare --restore /benchmark/input/oldworld-50.v8 --out "/benchmark/results/$label/result.json"); result=result.json ;;
  *) exit 2 ;;
esac
container=$(sudo docker run -d --rm --network none --cpus "$cores" --memory 2g --pids-limit 128 --read-only --tmpfs /tmp --user 1001:1001 \
  --entrypoint node "${mounts[@]}" "$image" --import tsx "${command[@]}")
trap 'sudo docker stop "$container" >/dev/null 2>&1 || true' EXIT
while sudo docker inspect "$container" >/dev/null 2>&1; do
  health=$(curl -fsS http://127.0.0.1:8080/healthz)
  [[ "$health" == *'"activeMatches":0'* ]] || { echo "Benchmark stopped: new live match"; exit 3; }
  sleep 10
done
test -s "$root/results/$label/$result"
cat "$root/results/$label/$result"
