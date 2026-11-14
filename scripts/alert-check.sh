#!/usr/bin/env sh
# Zone B. `make b-alert-check`: proves the alert path end to end for three guarantees.
# For each alert: break something, wait until Prometheus fires it, wait until the
# narrator (insights) receives it, undo the break, wait until it clears, then wait for
# the "resolved" notification (Alertmanager sends one because send_resolved: true).
#
# The narrator's log is the receipt: insights logs one "alert received" line per webhook
# call with the alert names in it. A call after the alert cleared is the resolved one.
# A failed delivery (insights down, or 404 before zone C's endpoint exists) shows as
# "never delivered" here and in alertmanager_notifications_failed_total.
set -u
cd "$(dirname "$0")/.."
. scripts/lib.sh

FAILS=0
ADMIN=$(admin_token) && [ -n "$ADMIN" ] || { bad "cannot get an admin token"; exit 1; }
trap 'chaos reset >/dev/null 2>&1 || true' EXIT
trap 'exit 130' INT TERM

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# Number of webhook calls insights logged for an alert since a time: delivered <name> <iso>
delivered() {
  docker compose logs --since "$2" --no-log-prefix insights 2>/dev/null \
    | grep '"msg":"alert received"' | grep -c "\"$1\"" | tr -d ' '
}
# Polls until a check passes, printing elapsed seconds: until_ok <limit> <command...>
until_ok() {
  lim=$1; shift; s=$(date +%s)
  while ! "$@"; do
    [ $(( $(date +%s) - s )) -ge "$lim" ] && return 1
    sleep 3
  done
  ELAPSED=$(( $(date +%s) - s ))
}
is_firing() { [ "$(alert_state "$1")" = firing ]; }
is_clear() { [ "$(alert_state "$1")" = none ]; }
got_since() { [ "$(delivered "$1" "$2")" -ge 1 ]; }
more_than() { [ "$(delivered "$1" "$2")" -gt "$3" ]; }
# Alertmanager drops a resolved alert from /api/v2/alerts once it has notified it.
am_resolved() {
  ! docker compose exec -T grafana wget -qO- "http://alertmanager:9093/api/v2/alerts?active=true" 2>/dev/null \
    | grep -q "\"alertname\":\"$1\""
}

# check <alert> <break command> <undo command> <fire limit> <clear limit>
check() {
  name=$1; brk=$2; undo=$3
  step "$name"
  t0=$(now_iso); eval "$brk"
  if until_ok "$4" is_firing "$name"; then ok "firing in Prometheus after ${ELAPSED} s"
  else bad "not firing after $4 s"; FAILS=$((FAILS + 1)); eval "$undo"; return; fi
  if until_ok 90 got_since "$name" "$t0"; then ok "delivered to insights after another ${ELAPSED} s"
  else bad "never delivered to insights (check alertmanager_notifications_failed_total)"; FAILS=$((FAILS + 1)); fi
  fired=$(delivered "$name" "$t0")
  eval "$undo"
  if until_ok "$5" is_clear "$name"; then ok "cleared in Prometheus after ${ELAPSED} s"
  else bad "still active after $5 s"; FAILS=$((FAILS + 1)); return; fi
  # Count calls after the firing one, not calls after we saw the clear: our poll of ALERTS
  # can see the clear a few seconds after Alertmanager already sent the resolved notice.
  if until_ok 90 more_than "$name" "$t0" "$fired" && until_ok 30 am_resolved "$name"; then
    ok "resolved: insights got a further notification and Alertmanager no longer holds the alert"
  else bad "no resolved notification within 90 s"; FAILS=$((FAILS + 1)); fi
}

chaos reset >/dev/null
for s in db s3 ftp; do wait_storage "$s" 120 >/dev/null || { bad "$s not usable before the check"; exit 1; }; done
# An alert still active from an earlier run is already notified for its group, so a new
# break with the same labels sends nothing new until repeat_interval (30 m). Start clean.
for a in StorageDown MeterReadingLossRisk IntegrityFailure; do
  until_ok 420 is_clear "$a" || { bad "$a is still active from before; run again later"; exit 1; }
done
ok "no alert active, starting"
# MeterReadingLossRisk needs a real backlog: at 10/s, 50 un-acked readings take 5 s.
chaos meters '{"readingsPerSec":10}' >/dev/null

check StorageDown \
  'note "stop s3 → HTTP $(chaos storages/s3/stop)"' \
  'note "start s3 → HTTP $(chaos storages/s3/start)"; wait_storage s3 120 >/dev/null' 120 180

check MeterReadingLossRisk \
  'note "stop db → HTTP $(chaos storages/db/stop)"' \
  'note "start db → HTTP $(chaos storages/db/start)"; wait_storage db 120 >/dev/null' 180 300

# IntegrityFailure looks back 5 minutes (increase over [5m]), so it clears ~5 min later.
CONN=$(login connections)
corrupt_one() {
  f=$(random_file 100000); id=$(upload "$CONN" document "$f" | json_str id); rm -f "$f"
  note "document $id: corrupt → HTTP $(chaos corrupt "{\"fileId\":\"$id\"}"), download → HTTP $(download "$CONN" "$id" | cut -d' ' -f1)"
}
check IntegrityFailure 'corrupt_one' 'note "nothing to undo: waiting out the 5 min window"' 90 420

say ""
fails=$(docker compose exec -T grafana wget -qO- http://alertmanager:9093/metrics 2>/dev/null \
  | sed -n 's/^alertmanager_notifications_failed_total{integration="webhook"[^}]*} //p' | awk '{s+=$1} END {print s+0}')
note "alertmanager webhook failures since it started: ${fails}"
if [ "$FAILS" = 0 ]; then ok "all three alerts fired, reached insights, cleared and sent resolved"; exit 0; fi
bad "${FAILS} check(s) failed"; exit 1
