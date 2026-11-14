#!/usr/bin/env sh
# Zone B. The judges' path, rehearsed: clone the repo into a temp dir, `make up` from
# nothing (fresh .env, fresh volumes, its own Compose project), then check every route
# and every gating requirement that can be checked from a terminal. Cleans up after itself.
#
#   scripts/fresh-clone-test.sh                      # origin, branch main
#   scripts/fresh-clone-test.sh --branch my-branch   # a branch (must be pushed, or use --repo .)
#   scripts/fresh-clone-test.sh --repo . --branch zone-b/x   # local commits, no push needed
#   options: --stop-running  pause a FileGrid stack already on 80/443 (data kept, restarted after)
#            --no-cache      rebuild every image without the build cache (closest to a new machine)
#            --keep          leave the clone and its stack running for inspection
#   make fresh-test [ARGS="--stop-running"]
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
. "$here/scripts/lib.sh"

REPO=$(git -C "$here" remote get-url origin 2>/dev/null || echo "$here")
BRANCH=main
STOP_RUNNING=0
NO_CACHE=0
KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO=$2; shift ;;
    --branch) BRANCH=$2; shift ;;
    --stop-running) STOP_RUNNING=1 ;;
    --no-cache) NO_CACHE=1 ;;
    --keep) KEEP=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done
case "$REPO" in /*|http*|git@*) ;; *) REPO=$(cd "$REPO" && pwd) ;; esac

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); ok "$*"; }
fail() { FAIL=$((FAIL + 1)); bad "$*"; }
expect() { # expect <description> <wanted> <got>
  if [ "$3" = "$2" ]; then pass "$1 ($3)"; else fail "$1: wanted $2, got $3"; fi
}

export COMPOSE_PROJECT_NAME="filegrid-fresh-$(date +%H%M%S)"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/filegrid-fresh.XXXXXX")
PAUSED=""

finish() {
  rc=$?
  if [ "$KEEP" = 1 ]; then
    note "kept: $WORK (project $COMPOSE_PROJECT_NAME). Remove: cd $WORK/repo && docker compose down -v --rmi local"
  else
    step "Cleanup"
    if [ -d "$WORK/repo" ]; then
      (cd "$WORK/repo" && docker compose --profile load down -v --rmi local --remove-orphans >/dev/null 2>&1) && ok "stack $COMPOSE_PROJECT_NAME removed (containers, volumes, images)"
    fi
    cd /; rm -rf "$WORK"
  fi
  if [ -n "$PAUSED" ]; then
    note "restarting the stack that was running before: $PAUSED"
    # By container label: the clone dir is gone, and the paused stack's files live elsewhere.
    ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PAUSED" --filter status=exited)
    if [ -z "$ids" ] || docker start $ids >/dev/null 2>&1; then ok "$PAUSED running again"; else bad "could not restart $PAUSED: make up in its folder"; fi
  fi
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT TERM

step "1  Clone ${REPO} (${BRANCH})"
command -v docker >/dev/null || { bad "Docker is required"; exit 1; }
busy=$(docker ps --filter publish=443 --format '{{.Label "com.docker.compose.project"}}' | head -n 1)
if [ -n "$busy" ]; then
  if [ "$STOP_RUNNING" = 1 ]; then
    note "pausing stack '$busy' that holds port 443 (containers stopped, data kept)"
    docker compose -p "$busy" stop >/dev/null 2>&1 && PAUSED=$busy
  else
    bad "port 443 is used by stack '${busy:-another container}'. Rerun with --stop-running (it is restarted afterwards)."
    exit 1
  fi
fi
git clone -q --branch "$BRANCH" "$REPO" "$WORK/repo" || { bad "git clone failed"; exit 1; }
cd "$WORK/repo"
pass "cloned $(git log --oneline -1 | cut -c1-70)"
[ ! -f .env ] && pass "no .env in the clone (secrets are generated, never committed)" || fail ".env is committed"

step "2  make up (the one command from the README)"
if [ "$NO_CACHE" = 1 ]; then
  note "building every image without the cache"
  docker compose build --no-cache >/dev/null 2>&1 || { fail "docker compose build --no-cache"; exit 1; }
fi
t0=$(date +%s)
if make up > "$WORK/make-up.log" 2>&1; then
  took=$(( $(date +%s) - t0 ))
  pass "make up finished in ${took} s, every service with a healthcheck healthy"
  [ "$took" -le 180 ] && pass "under the 3-minute target" || fail "slower than the 3-minute target (${took} s)"
else
  fail "make up failed; last lines:"; tail -n 20 "$WORK/make-up.log" | sed 's/^/    /'
  exit 1
fi
[ "$(grep -c '__GENERATE__' .env)" = 0 ] && pass ".env generated with random secrets" || fail ".env still has placeholders"

step "3  Every route through the gateway"
# The gateway checks a new replica within seconds; give each route up to 60 s.
route() { # route <path> <expected status> [curl args]
  p=$1; want=$2; shift 2
  i=0; got=000
  while [ "$i" -lt 30 ]; do
    got=$(code GET "$p" "$@"); [ "$got" = "$want" ] && break
    sleep 2; i=$((i + 1))
  done
  expect "GET $p" "$want" "$got"
}
expect "http://${HOST} redirects to https" "301" "$(curl -s -o /dev/null -w '%{http_code}' "http://${HOST}/")"
route /api/v1/health 200
route /insights/health 200
route /mock/api/v1/health 200
route / 200
route /grafana 308
route /grafana/ 200
route /chaos/state 401
ADMIN=$(admin_token)
route /chaos/state 200 -H "authorization: Bearer ${ADMIN}"
grafana_home=$(curl -sk "${BASE}/grafana/api/dashboards/home" | json_str title)
expect "Grafana home dashboard" "FileGrid Overview" "$grafana_home"

step "4  Login (demo users, password from .env)"
for u in admin dispatch connections field; do
  t=$(login "$u"); [ -n "$t" ] && pass "login $u" || fail "login $u"
done
expect "wrong password refused" 401 "$(curl -sk -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"username":"admin","password":"wrong"}' "${BASE}/api/v1/auth/login")"
expect "files need a token" 401 "$(code GET /api/v1/files)"

step "5  Store and retrieve every category, byte-identical (gating 1, 2, 4)"
roundtrip() { # roundtrip <user> <category> <bytes> <expected storage>
  tok=$(login "$1"); f=$(random_file "$3"); sent=$(sha256_of "$f")
  r=$(upload "$tok" "$2" "$f"); rm -f "$f"
  id=$(printf '%s' "$r" | json_str id); st=$(printf '%s' "$r" | json_str storage); rsha=$(printf '%s' "$r" | json_str sha256)
  [ -n "$id" ] || { fail "$2 upload: $r"; return; }
  set -- "$2" "$4" "$st" "$rsha" "$sent" $(download "$tok" "$id")
  [ "$3" = "$2" ] && pass "$1 stored in $3 (policy)" || fail "$1 stored in $3, policy says $2"
  [ "$4" = "$5" ] && [ "$6" = 200 ] && [ "$7" = "$5" ] && pass "$1 downloaded byte-identical, SHA-256 = receipt" || fail "$1 round trip: receipt $4, sent $5, download $6 $7"
}
roundtrip dispatch outage 2000000 s3
roundtrip connections document 500000 ftp
# Video: tus resumable upload in one PATCH (the web app sends 16 MB chunks).
tok=$(login field); f=$(random_file 6000000); sent=$(sha256_of "$f")
meta="category $(printf video | base64),filename $(printf fresh-test.mp4 | base64)"
loc=$(curl -sk -D - -o /dev/null -X POST -H "authorization: Bearer $tok" -H 'Tus-Resumable: 1.0.0' -H 'Upload-Length: 6000000' -H "Upload-Metadata: $meta" "${BASE}/api/v1/files/tus" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p')
vid=$(curl -sk -D - -o /dev/null -X PATCH -H "authorization: Bearer $tok" -H 'Tus-Resumable: 1.0.0' -H 'Upload-Offset: 0' -H 'Content-Type: application/offset+octet-stream' --data-binary "@$f" "${BASE}${loc}" | tr -d '\r' | sed -n 's/^[Xx]-[Ff]ile[Gg]rid-[Ff]ile-[Ii]d: //p')
rm -f "$f"
if [ -n "$vid" ]; then
  set -- $(download "$tok" "$vid")
  [ "$1" = 200 ] && [ "$2" = "$sent" ] && pass "video (tus) uploaded and downloaded byte-identical" || fail "video download: $1"
else
  fail "video tus upload (Location: ${loc:-none})"
fi
note "meter readings: the simulator has been sending since make up"
stored=$(prom 'sum(filegrid_meter_readings_total{result="accepted"})' 0)
[ "$stored" != "-" ] && [ "$stored" -gt 0 ] 2>/dev/null && pass "meter readings stored: $stored (gating 7)" || fail "no meter readings stored yet"

step "6  Locked down (NFR security)"
if command -v nc >/dev/null 2>&1; then
  for port in 5432 8333 8888 9333 21 8080 8088 8090 9090 9100 3000; do
    if nc -z -w 2 "$HOST" "$port" 2>/dev/null; then fail "port $port reachable from the host"; else pass "port $port closed"; fi
  done
else
  note "nc not installed: port checks skipped"
fi
published=$(docker compose ps --format '{{.Service}} {{.Publishers}}' | grep -E '0\.0\.0\.0|::' | cut -d' ' -f1 | sort -u | tr '\n' ' ')
expect "only caddy and toxiproxy publish ports" "caddy toxiproxy " "$published"
sock=$(grep -rl 'docker.sock' infra/compose.yml services/*/compose.yml apps/*/compose.yml 2>/dev/null | tr '\n' ' ')
expect "only chaos-control mounts the Docker socket" "services/chaos-control/compose.yml " "$sock"

step "7  Observability"
down=$(prom 'count(up == 0)' 0)
[ "$down" = "-" ] && pass "every Prometheus target is up" || fail "$down Prometheus targets down"
rules=$(curl -sk "${PROM}/rules" | grep -o '"type":"alerting"' | wc -l | tr -d ' ')
[ "$rules" -ge 7 ] && pass "$rules alert rules loaded" || fail "only $rules alert rules loaded"
firing=$(curl -sk -G --data-urlencode 'query=count(ALERTS{alertstate="firing"})' "${PROM}/query" | sed -n 's/.*"value":\[[^,]*,"\([^"]*\)"\].*/\1/p')
[ -z "$firing" ] && pass "no alert firing on a healthy stack" || fail "$firing alerts firing on a fresh stack"

step "Result"
say "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" = 0 ]
