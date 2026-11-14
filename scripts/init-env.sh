#!/usr/bin/env sh
# Creates .env from .env.example on first run, replacing each __GENERATE__ with a random
# 32-byte hex secret. On later runs:
#  - keys added to .env.example are appended;
#  - a key whose default changed in .env.example is updated, but only if .env still holds
#    a value that some committed version of .env.example shipped (a stale default, e.g.
#    METER_TARGET_URL pointing at the mock). A value you typed yourself never appears in
#    that history, so it is kept;
#  - secrets (__GENERATE__) are never touched, so they never change under running volumes.
set -eu
cd "$(dirname "$0")/.."
gen() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }

if [ ! -f .env ]; then
  : > .env
  echo "Generating .env with fresh secrets"
fi

# Every value each key ever had in committed versions of .env.example, as KEY=value lines.
# Empty when git or the history is unavailable (a zip download): then nothing is updated.
history=$(git log --format= -p -- .env.example 2>/dev/null | sed -n 's/^[-+]\([A-Z0-9_]*=.*\)$/\1/p' | sort -u || true)

# Replaces KEY's line in .env; the value goes through the environment, so slashes, & or
# quotes in it cannot break the substitution.
set_value() {
  NEW_VALUE=$2 awk -v key="$1" 'BEGIN { v = ENVIRON["NEW_VALUE"] } index($0, key "=") == 1 { print key "=" v; next } { print }' .env > .env.tmp
  cat .env.tmp > .env
  rm -f .env.tmp
}

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  key=${line%%=*}
  value=${line#*=}
  if ! grep -q "^${key}=" .env; then
    [ "$value" = "__GENERATE__" ] && value=$(gen)
    printf '%s=%s\n' "$key" "$value" >> .env
    continue
  fi
  [ "$value" = "__GENERATE__" ] && continue
  current=$(grep "^${key}=" .env | head -n 1)
  current=${current#*=}
  [ "$current" = "$value" ] && continue
  if printf '%s\n' "$history" | grep -Fxq -- "${key}=${current}"; then
    set_value "$key" "$value"
    echo "Updated ${key} in .env: the default changed (${current} -> ${value})"
  fi
done < .env.example
chmod 600 .env
