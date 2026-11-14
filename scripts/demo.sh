#!/usr/bin/env sh
# Zone B. `make demo`: the live storm story, step by step, with a pause before each step
# so it can be rehearsed and presented. Every step prints the numbers it proves; Grafana
# (FileGrid Overview) and the web app's Operations page show the same thing live.
#
#   1 baseline        meters at 10/s, normal latencies
#   2 outage storm    outage x10 for 60 s: meter p95 stays flat (NFR scalability)
#   3 stop S3         outage records fall back to the database, alert StorageDown (resilience);
#                     start S3, wait with a countdown until FileGrid sees it, outage back on s3
#   4 degrade network slow lane 400 ms and 5 % loss vs the direct path (resilience)
#   5 corrupt a file  flipped byte in storage, download refused 422, alert IntegrityFailure
#   6 reset           everything back, alerts resolve
#
# DEMO_AUTO=5 make demo   runs unattended with 5 s pauses (rehearsal).
# Ctrl-C at any point resets the chaos, so the stack is never left broken.
set -u
cd "$(dirname "$0")/.."
. scripts/lib.sh

METER_RATE=${DEMO_METER_RATE:-10}
STORM_SEC=${DEMO_STORM_SEC:-60}

# Whatever ends the script early (Ctrl-C, an error), the chaos is undone.
DONE=0
on_exit() {
  if [ "$DONE" != 1 ] && [ -n "${ADMIN:-}" ]; then
    printf '\n'
    note "stopped early: resetting chaos so the stack is not left broken"
    chaos reset >/dev/null 2>&1 || true
  fi
}
trap on_exit EXIT
trap 'exit 130' INT TERM

meter_p95='histogram_quantile(0.95, sum by (le) (rate(filegrid_op_duration_seconds_bucket{category="meter",op="write"}[30s]))) * 1000'
outage_rate='sum(rate(filegrid_ops_total{category="outage",op="write"}[30s]))'
outage_p95='histogram_quantile(0.95, sum by (le) (rate(filegrid_op_duration_seconds_bucket{category="outage",op="write"}[30s]))) * 1000'

step "0  Preflight"
[ "$(code GET /api/v1/health)" = 200 ] || { bad "FileGrid is not answering on ${BASE}: run make up"; exit 1; }
ADMIN=$(admin_token) && [ -n "$ADMIN" ] || { bad "cannot get an admin token from chaos-control"; exit 1; }
DISPATCH=$(login dispatch); CONNECTIONS=$(login connections)
[ -n "$DISPATCH" ] && [ -n "$CONNECTIONS" ] || { bad "demo login failed (DEMO_PASSWORD in .env)"; exit 1; }
chaos reset >/dev/null
ok "stack up, logged in as dispatch and connections, chaos cleared"
say "  Open:  ${B}${BASE}/grafana${N}  (FileGrid Overview, refresh 5 s)"
say "         ${B}${BASE}${N}  → Operations (chaos timeline)"
pause "Enter: 1 baseline"

step "1  Baseline: a normal day"
chaos meters "{\"readingsPerSec\":${METER_RATE}}" >/dev/null
note "meters set to ${METER_RATE} readings/s; letting Prometheus collect 30 s"
sleep 30
ok "meter readings stored per second: $(prom 'sum(rate(filegrid_meter_readings_total{result="accepted"}[30s]))' 1)"
ok "meter p95 save time: $(prom "$meter_p95" 1) ms"
BASE_P95=$(prom "$meter_p95" 1)
pause "Enter: 2 outage storm x10"

step "2  Storm: outage records x10 for ${STORM_SEC} s"
say "  Claim: a 10x spike in one category does not slow the others down."
chaos storm "{\"category\":\"outage\",\"multiplier\":10,\"durationSec\":${STORM_SEC}}" >/dev/null
printf '  %-6s %-22s %-18s %s\n' "t" "outage saves/s" "outage p95 ms" "meter p95 ms (baseline ${BASE_P95})"
t=0
while [ "$t" -lt "$STORM_SEC" ]; do
  sleep 10; t=$((t + 10))
  printf '  %-6s %-22s %-18s %s\n' "+${t}s" "$(prom "$outage_rate" 1)" "$(prom "$outage_p95" 0)" "$(prom "$meter_p95" 1)"
done
ok "storm over: meter p95 stayed at $(prom "$meter_p95" 1) ms while outage volume rose tenfold"
pause "Enter: 3 stop S3"

step "3  Storage down: stop S3 (SeaweedFS)"
say "  Claim: one storage down does not stop other categories or lose confirmed files."
note "stop s3 → HTTP $(chaos storages/s3/stop)"
sleep 3
f=$(random_file 2000000); r=$(upload "$DISPATCH" outage "$f"); rm -f "$f"
if [ "$(printf '%s' "$r" | json_str storage)" = "db" ]; then ok "outage record accepted anyway, stored in the fallback: db (policy outage: s3 → db)"
else bad "outage upload with S3 down: $r"; fi
f=$(random_file 300000); r=$(upload "$CONNECTIONS" document "$f"); rm -f "$f"
ok "customer document still stored in $(printf '%s' "$r" | json_str storage), encrypted=$(printf '%s' "$r" | json_raw encrypted)"
ok "meter readings still stored: $(prom 'sum(rate(filegrid_meter_readings_total{result="accepted"}[30s]))' 1)/s"
note "waiting for the alert (StorageDown, 30 s confirmation)..."
if wait_for 120 firing alert_state StorageDown; then ok "alert StorageDown firing → narrator (Operations page)"; else bad "StorageDown not firing after 120 s"; fi
ok "storage s3 up=$(prom 'max(filegrid_storage_up{storage="s3"})' 0), circuit open=$(prom 'max(filegrid_circuit_open{storage="s3"})' 0)"
pause "Enter: start S3 again"

note "start s3 → HTTP $(chaos storages/s3/start)"
# The next steps must not run while FileGrid still treats S3 as down: an upload would go
# to the fallback and the story would no longer match what the dashboard shows.
if wait_storage s3 "${DEMO_S3_WAIT:-120}"; then
  f=$(random_file 2000000); r=$(upload "$DISPATCH" outage "$f"); rm -f "$f"
  [ "$(printf '%s' "$r" | json_str storage)" = "s3" ] && ok "outage records go to s3 again, no restart of FileGrid" || bad "outage after S3 is back: $r"
else
  bad "FileGrid still sees S3 down after ${DEMO_S3_WAIT:-120} s (make logs s=filegrid-api)"
fi
pause "Enter: 4 degrade network"

step "4  Bad link: slow lane with 400 ms latency and 5 % connection loss"
say "  Claim: transfers on high-latency lossy links finish or resume without manual action."
fast=$(timing "${BASE}/api/v1/health"); before=$(timing "https://${HOST}:8443/api/v1/health")
note "degrade client → HTTP $(chaos network '{"target":"client","latencyMs":400,"jitterMs":50,"lossPct":5}')"
after=$(timing "https://${HOST}:8443/api/v1/health")
ok "same request: direct ${fast}, slow lane before ${before}, slow lane now ${after}"
note "full proof (video resumed across cut connections, byte-identical): make b-load S=video-lossy"
pause "Enter: 5 corrupt a file"

step "5  Corruption: flip one byte of a stored file, behind FileGrid's back"
say "  Claim: a retrieved file is identical to the stored one, and FileGrid proves it."
f=$(random_file 400000); sent=$(sha256_of "$f"); r=$(upload "$CONNECTIONS" document "$f"); rm -f "$f"
id=$(printf '%s' "$r" | json_str id)
set -- $(download "$CONNECTIONS" "$id")
[ "$1" = 200 ] && [ "$2" = "$sent" ] && ok "document $id: download 200, SHA-256 matches the upload" || bad "clean download: $1"
note "corrupt → HTTP $(chaos corrupt "{\"fileId\":\"$id\"}")"
set -- $(download "$CONNECTIONS" "$id")
[ "$1" = 422 ] && ok "download now refused: 422 INTEGRITY_FAILED (bytes in storage ≠ recorded SHA-256)" || bad "download after corruption: $1"
if wait_for 60 firing alert_state IntegrityFailure; then ok "alert IntegrityFailure firing → narrator"; else bad "IntegrityFailure not firing after 60 s"; fi
pause "Enter: 6 reset"

step "6  Reset"
note "reset → HTTP $(chaos reset)"
for s in db s3 ftp; do wait_storage "$s" 120 || bad "FileGrid still sees $s down after 120 s"; done
note "parked files move back on their own; spool now: $(prom 'sum(filegrid_spool_pending)' 0)"
ok "slow lane back to $(timing "https://${HOST}:8443/api/v1/health"); meters back to the .env rate"
note "alerts resolve within about 2 minutes; the narrator reports each resolution"
say ""
DONE=1
say "${B}Done.${N} Rerun anytime: make demo   (unattended: DEMO_AUTO=5 make demo)"
