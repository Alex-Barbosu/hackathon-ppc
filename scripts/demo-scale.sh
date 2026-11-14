#!/usr/bin/env sh
# Zone B. `make demo-scale`: scale out and load, with pauses.
#   1 scale filegrid-api to 3 replicas (no code change)
#   2 k6 outage storm x10 through the gateway; one replica is taken out halfway through
#     (docker stop: it finishes what it has and refuses new work, as when scaling in)
#     → the load spreads over the replicas, documents stay fast, no request fails.
#     DEMO_CRASH=1 kills it instead (docker kill): then the uploads in flight on it fail,
#     as on any crash, and the client retries them; nothing else is affected.
#   3 k6 drone video over the slow, lossy lane → resumed after every cut, byte-identical
#   4 back to the replica count you started with
# DEMO_AUTO=5 make demo-scale   runs unattended. Full k6 output: /tmp/filegrid-k6-*.log
set -u
cd "$(dirname "$0")/.."
. scripts/lib.sh

REPLICAS=${DEMO_REPLICAS:-3}
STORM=${DEMO_STORM_DURATION:-60s}
VIDEO_MB=${DEMO_VIDEO_MB:-256}
replicas() { docker compose ps -q filegrid-api | wc -l | tr -d ' '; }
START_REPLICAS=$(replicas)

restore() {
  [ "$(replicas)" = "$START_REPLICAS" ] && return
  note "back to ${START_REPLICAS} replica(s)"
  docker compose up -d --no-recreate --scale "filegrid-api=${START_REPLICAS}" --wait filegrid-api >/dev/null 2>&1 || true
}
trap restore EXIT
trap 'exit 130' INT TERM

# Prints the summary lines worth reading aloud from a k6 log.
k6_summary() {
  grep -E "✓|✗|http_req_failed|checks\.|scenario:documents|upload_retries|video_chunk|video_resumes|video: |level=error" "$1" \
    | grep -vE '^\s*(█|setup|teardown)' | sed -E 's/.*msg="([^"]*)".*/\1/; s/^ +/    /' | cut -c1-150
}

step "0  Preflight"
[ "$(code GET /api/v1/health)" = 200 ] || { bad "FileGrid is not answering on ${BASE}: run make up"; exit 1; }
ok "running with ${START_REPLICAS} filegrid-api replica(s)"
say "  Open: ${B}${BASE}/grafana${N} → FileGrid Overview: *Operations per API replica* and *Load tests (k6)*"
pause "Enter: 1 scale out to ${REPLICAS} replicas"

step "1  Scale out: ${REPLICAS} replicas of the API, no code change"
t0=$(date +%s)
docker compose up -d --no-recreate --scale "filegrid-api=${REPLICAS}" --wait filegrid-api >/dev/null 2>&1 \
  || { bad "scaling failed: docker compose logs filegrid-api"; exit 1; }
ok "${REPLICAS} replicas healthy in $(( $(date +%s) - t0 )) s; the gateway finds them through Docker DNS within 5 s"
docker compose ps filegrid-api --format '    {{.Name}}  {{.Status}}'
sleep 6
pause "Enter: 2 outage storm x10 with k6, taking one replica out halfway"

step "2  Storm with k6: outage records x10 (5 MB each) for ${STORM}, documents as the bystander"
say "  Claim: more instances share the load, and losing one does not stop the service."
log=/tmp/filegrid-k6-storm-$(date +%H%M%S).log
victim=$(docker compose ps -q filegrid-api | tail -n 1)
victim_name=$(docker inspect -f '{{.Name}}' "$victim" | tr -d /)
half=$(( $(printf '%s' "$STORM" | tr -dc 0-9) / 2 ))
if [ -n "${DEMO_CRASH:-}" ]; then how=kill; what="crashed (docker kill)"; else how=stop; what="taken out (docker stop)"; fi
( sleep "$half"; docker "$how" "$victim" >/dev/null 2>&1 && printf '  %s✗ %s %s at +%ss%s\n' "$R" "$victim_name" "$what" "$half" "$N" ) &
killer=$!
make -s b-load S=storm-outage DURATION="$STORM" > "$log" 2>&1
rc=$?
wait "$killer" 2>/dev/null
k6_summary "$log"
[ "$rc" = 0 ] && ok "k6 thresholds passed: every upload stored (> 99 %), documents p95 < 3 s during the storm" || bad "k6 thresholds failed (exit $rc): see $log"
note "upload_retries = uploads the client resent because the replica serving them went away"
say "  Operations per replica during the storm:"
curl -sk -G --data-urlencode 'query=round(sum by (instance) (increase(filegrid_ops_total[2m])))' "${PROM}/query" \
  | tr '{' '\n' | sed -n 's/.*"instance":"\([^"]*\)".*"value":\[[^,]*,"\([^"]*\)"\].*/    \1  \2 operations/p'
ok "meter p95 during the storm: $(prom 'histogram_quantile(0.95, sum by (le) (rate(filegrid_op_duration_seconds_bucket{category="meter",op="write"}[1m]))) * 1000' 1) ms"
pause "Enter: 3 drone video over a bad link"

step "3  Drone video (${VIDEO_MB} MB) over the slow lane: 150 ms ± 50 ms, 20 % of connections cut"
say "  Claim: a transfer on a lossy link resumes on its own and arrives byte-identical."
log=/tmp/filegrid-k6-video-$(date +%H%M%S).log
make -s b-load S=video-lossy VIDEO_MB="$VIDEO_MB" > "$log" 2>&1
rc=$?
k6_summary "$log"
[ "$rc" = 0 ] && ok "video complete and byte-identical; the link is healed again" || bad "video scenario failed (exit $rc): see $log"
pause "Enter: 4 scale back"

step "4  Scale back"
restore
ok "$(replicas) replica(s) running"
say ""
say "${B}Done.${N} Rerun: make demo-scale   (unattended: DEMO_AUTO=5 make demo-scale)"
