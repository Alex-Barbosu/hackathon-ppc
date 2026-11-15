#!/usr/bin/env sh
# Zone B. `make tunnel`: a public HTTPS link to this FileGrid for mentors and judges.
# Starts the cloudflared quick tunnel (infra/compose.yml, profile "tunnel"), waits for the
# trycloudflare URL Cloudflare assigns, checks the link really reaches FileGrid, prints it.
# The URL changes every time the tunnel starts; `make tunnel-down` closes it.
set -u
cd "$(dirname "$0")/.."
. scripts/lib.sh

[ "$(code GET /api/v1/health)" = 200 ] || { bad "FileGrid is not answering on ${BASE}: run make up first"; exit 1; }
docker compose --profile tunnel up -d cloudflared >/dev/null 2>&1 || { bad "could not start cloudflared (make logs s=cloudflared)"; exit 1; }

# cloudflared prints the URL once Cloudflare has assigned it; the container may be older than
# this run (already up), so read its whole log, newest URL wins.
url=""
i=0
while [ "$i" -lt 60 ]; do
  url=$(docker compose --profile tunnel logs --no-log-prefix cloudflared 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -n 1)
  [ -n "$url" ] && break
  sleep 2; i=$((i + 2))
done
[ -n "$url" ] || { bad "no tunnel URL after 60 s (make logs s=cloudflared; outbound HTTPS to Cloudflare blocked?)"; exit 1; }

# A new hostname takes a few seconds to answer worldwide.
i=0; st=000
while [ "$i" -lt 60 ]; do
  st=$(curl -s -o /dev/null -w '%{http_code}' "${url}/api/v1/health")
  [ "$st" = 200 ] && break
  sleep 3; i=$((i + 3))
done
[ "$st" = 200 ] || { bad "${url} does not reach FileGrid yet (last HTTP ${st}); try again in a minute"; exit 1; }

ok "FileGrid is public at ${B}${url}${N}"
say ""
say "  Web app   ${url}"
say "  Grafana   ${url}/grafana"
say ""
note "anyone with the link can open it: logins still need DEMO_PASSWORD, /chaos needs an admin token,"
note "Grafana dashboards and Explore are open read-only. Close it with: make tunnel-down"
note "Cloudflare refuses a single request over 100 MB; videos upload in 16 MB tus chunks, which stay under it"
