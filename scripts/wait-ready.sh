#!/usr/bin/env sh
# Zone B. Run by `make up` after `docker compose up --wait`. Containers can be healthy
# while filegrid-api still has a storage marked down: it starts as soon as PostgreSQL is
# up, so its first probe of SeaweedFS or FTP can fail and open that circuit for ~15 s.
# During that window an outage upload lands in the fallback and a video upload gets 503.
# This waits until FileGrid itself reports every storage reachable and every circuit
# closed, so "make up finished" means files can really be stored.
set -u
cd "$(dirname "$0")/.."
. scripts/lib.sh
limit=${READY_TIMEOUT:-90}
token=$(admin_token 2>/dev/null)
i=0
while [ "$i" -lt "$limit" ]; do
  h=$(curl -sk -H "authorization: Bearer ${token}" "${BASE}/api/v1/storages/health")
  ups=$(printf '%s' "$h" | grep -o '"up":true' | wc -l | tr -d ' ')
  closed=$(printf '%s' "$h" | grep -o '"circuitOpen":false' | wc -l | tr -d ' ')
  if [ "$ups" = 3 ] && [ "$closed" = 3 ]; then
    ok "FileGrid reaches PostgreSQL, S3 and FTP (${i} s after the containers were healthy)"
    exit 0
  fi
  sleep 3; i=$((i + 3))
done
bad "after ${limit} s FileGrid still reports a storage down: ${h:-no answer}"
note "check: make logs s=filegrid-api"
exit 1
