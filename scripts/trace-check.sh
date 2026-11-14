#!/usr/bin/env sh
# Zone B. `make b-trace`: proves "one operation traceable from request to storage".
# Uploads one outage record, reads its trace back from Tempo through Grafana, checks the
# chain gateway → API → storage write, finds its log line in Loki, and prints a Grafana
# Explore link that opens the same trace (the receipt's traceId).
set -u
cd "$(dirname "$0")/.."
. scripts/lib.sh

GRAF="${BASE}/grafana"
T=$(login dispatch); [ -n "$T" ] || { bad "login failed (DEMO_PASSWORD in .env)"; exit 1; }
f=$(random_file 500000); r=$(upload "$T" outage "$f"); rm -f "$f"
tid=$(printf '%s' "$r" | json_str traceId); fid=$(printf '%s' "$r" | json_str id); st=$(printf '%s' "$r" | json_str storage)
[ -n "$tid" ] || { bad "no traceId in the receipt: $r"; exit 1; }
ok "outage record $fid stored on $st, receipt traceId $tid"

# Spans are batched for a few seconds before they reach Tempo.
trace=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  trace=$(curl -sk "${GRAF}/api/datasources/proxy/uid/tempo/api/traces/${tid}")
  case "$trace" in *'"storage.write"'*) break ;; esac
done
fails=0
for span in 'caddy /api' 'http post /api/v1/files' 'policy.route' 'storage.write'; do
  case "$trace" in *"\"name\":\"$span\""*) ok "span: $span" ;; *) bad "span missing: $span"; fails=$((fails + 1)) ;; esac
done
case "$trace" in *"\"stringValue\":\"$fid\""*) ok "spans carry filegrid.file_id=$fid" ;; *) bad "file_id not on the spans"; fails=$((fails + 1)) ;; esac

# The trace id is OTLP structured metadata in Loki, so filter on the field, not the text.
now=$(date +%s); logs=$(curl -sk -G "${GRAF}/api/datasources/proxy/uid/loki/loki/api/v1/query_range" \
  --data-urlencode "query={service_name=\"filegrid-api\"} | trace_id=\"${tid}\"" \
  --data-urlencode "start=$((now - 600))000000000" --data-urlencode "end=${now}000000000")
case "$logs" in *"stored file_id=${fid}"*) ok "log line in Loki for this trace: stored file_id=${fid}" ;; *) bad "no Loki log line for this trace"; fails=$((fails + 1)) ;; esac

panes=$(printf '{"a":{"datasource":"tempo","queries":[{"refId":"A","datasource":{"type":"tempo","uid":"tempo"},"queryType":"traceql","query":"%s"}],"range":{"from":"now-1h","to":"now"}}}' "$tid")
enc=$(printf '%s' "$panes" | sed -e 's/%/%25/g' -e 's/{/%7B/g' -e 's/}/%7D/g' -e 's/"/%22/g' -e 's/:/%3A/g' -e 's/,/%2C/g' -e 's/\[/%5B/g' -e 's/\]/%5D/g' -e 's/ /%20/g')
say ""
say "  Open this trace in Grafana:"
say "  ${B}${GRAF}/explore?schemaVersion=1&orgId=1&panes=${enc}${N}"
[ "$fails" = 0 ] && { ok "one upload traced from the gateway to the storage write, with its logs"; exit 0; }
bad "${fails} check(s) failed"; exit 1
