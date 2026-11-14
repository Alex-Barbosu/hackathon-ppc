# Zone B. Shared helpers for scripts/demo.sh, demo-scale.sh and fresh-clone-test.sh.
# POSIX sh plus curl only: no python or jq, so the scripts run on a judge's Mac as is.
# Expects HOST (default localhost) and runs docker compose in the current directory.

HOST=${HOST:-localhost}
BASE="https://${HOST}"
PROM="${BASE}/grafana/api/datasources/proxy/uid/prometheus/api/v1"

if [ -t 1 ]; then
  B=$(printf '\033[1m'); G=$(printf '\033[32m'); R=$(printf '\033[31m'); Y=$(printf '\033[33m'); C=$(printf '\033[36m'); N=$(printf '\033[0m')
else
  B=; G=; R=; Y=; C=; N=
fi

say() { printf '%s\n' "$*"; }
step() { printf '\n%s━━ %s%s\n' "$B$C" "$*" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
bad() { printf '  %s✗%s %s\n' "$R" "$N" "$*"; }
note() { printf '  %s→%s %s\n' "$Y" "$N" "$*"; }

# First "key":"value" string field of a JSON body on stdin (flat fields only).
json_str() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p" | head -n 1; }
# First "key":<number|true|false> field.
json_raw() { sed -n "s/.*\"$1\":\\([^,}]*\\).*/\\1/p" | head -n 1; }

# HTTP status of a request: code GET /path [curl args...]
code() { m=$1; p=$2; shift 2; curl -sk -o /dev/null -w '%{http_code}' -X "$m" "$@" "${BASE}${p}"; }

env_value() { sed -n "s/^$1=//p" .env | head -n 1; }

# Admin JWT signed inside chaos-control (same secret as zone A's login).
admin_token() { docker compose exec -T chaos-control node dist/token.js < /dev/null; }

# Session token of a demo user (the username decides the role).
login() {
  curl -sk -H 'content-type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$(env_value DEMO_PASSWORD)\"}" \
    "${BASE}/api/v1/auth/login" | json_str token
}

# One instant Prometheus value, rounded: prom '<promql>' [decimals]. Prints - when empty.
prom() {
  v=$(curl -sk -G --data-urlencode "query=$1" "${PROM}/query" | sed -n 's/.*"value":\[[^,]*,"\([^"]*\)"\].*/\1/p' | head -n 1)
  [ -n "$v" ] && [ "$v" != "NaN" ] && printf "%.${2:-2}f" "$v" || printf -- '-'
}

# Alert state as Prometheus sees it: firing, pending or none.
alert_state() {
  s=$(curl -sk -G --data-urlencode "query=ALERTS{alertname=\"$1\"}" "${PROM}/query" | sed -n 's/.*"alertstate":"\([a-z]*\)".*/\1/p' | head -n 1)
  printf '%s' "${s:-none}"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi
}

# A file of random bytes: random_file <bytes>. Prints its path; delete it when done.
random_file() { f=$(mktemp); head -c "$1" /dev/urandom > "$f"; printf '%s' "$f"; }

# Uploads a file: upload <token> <category> <path>. Prints the receipt JSON.
upload() {
  curl -sk -H "authorization: Bearer $1" -F "category=$2" -F "region=dobrogea" -F "file=@$3;filename=demo-$2.bin" "${BASE}/api/v1/files"
}

# Downloads a file and prints "<status> <sha256 of the bytes>".
download() {
  f=$(mktemp)
  s=$(curl -sk -o "$f" -w '%{http_code}' -H "authorization: Bearer $1" "${BASE}/api/v1/files/$2/content")
  printf '%s %s' "$s" "$(sha256_of "$f")"
  rm -f "$f"
}

chaos() {
  # chaos <path> [json body]
  if [ $# -gt 1 ]; then
    curl -sk -o /dev/null -w '%{http_code}' -H "authorization: Bearer ${ADMIN}" -H 'content-type: application/json' -d "$2" "${BASE}/chaos/$1"
  else
    curl -sk -o /dev/null -w '%{http_code}' -H "authorization: Bearer ${ADMIN}" -X POST "${BASE}/chaos/$1"
  fi
}

# Milliseconds for one request: timing <url>
timing() { curl -sk -o /dev/null -w '%{time_total}' "$1" | awk '{ printf "%.0f ms", $1 * 1000 }'; }

# Waits for the presenter. DEMO_AUTO=<seconds> runs unattended (rehearsal, CI).
pause() {
  if [ -n "${DEMO_AUTO:-}" ]; then
    sleep "$DEMO_AUTO"
  elif [ -r /dev/tty ]; then
    printf '\n  %s⏎ %s%s ' "$B" "${1:-Enter to continue}" "$N"
    read -r _ < /dev/tty || true
  fi
}

# "up" when FileGrid itself reports a storage reachable AND its circuit closed, else "down".
# The container being up is not enough: after a restart filegrid-api keeps the circuit open
# for a while, and until it closes an upload still lands in the fallback.
storage_state() {
  o=$(curl -sk -H "authorization: Bearer ${ADMIN}" "${BASE}/api/v1/storages/health" \
    | tr -d ' \n' | sed -n "s/.*\({\"storage\":\"$1\"[^}]*}\).*/\1/p")
  case "$o" in *'"up":true'*'"circuitOpen":false'*) printf up ;; *) printf down ;; esac
}

# Waits until FileGrid reports a storage usable, with a visible countdown:
# wait_storage <db|s3|ftp> <seconds>. Returns 1 on timeout.
wait_storage() {
  start=$(date +%s); limit=$2
  while :; do
    n=$(( $(date +%s) - start ))
    if [ "$(storage_state "$1")" = up ]; then
      [ -t 1 ] && printf '\r\033[K'
      ok "FileGrid reports $1 up, circuit closed, after ${n} s"
      return 0
    fi
    [ "$n" -ge "$limit" ] && { [ -t 1 ] && printf '\r\033[K'; return 1; }
    # On a terminal the countdown rewrites one line; in a log it prints every 10 s.
    if [ -t 1 ]; then printf '\r  %s⏳%s waiting for FileGrid to see %s again: %3d s left ' "$Y" "$N" "$1" $((limit - n))
    elif [ $((n % 10)) -lt 2 ]; then note "waiting for FileGrid to see $1 again: $((limit - n)) s left"; fi
    sleep 2
  done
}

# Polls until a command prints the expected text: wait_for <seconds> <expected> <command...>
wait_for() {
  limit=$1; want=$2; shift 2
  i=0
  while [ "$i" -lt "$limit" ]; do
    [ "$("$@")" = "$want" ] && return 0
    sleep 5; i=$((i + 5))
  done
  return 1
}
