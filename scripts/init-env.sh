#!/usr/bin/env sh
# Creates .env from .env.example on first run, replacing each __GENERATE__ with a random
# 32-byte hex secret. Existing .env files are left untouched, and keys added to
# .env.example later are appended, so secrets never change under running volumes.
set -eu
cd "$(dirname "$0")/.."

gen() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }

if [ ! -f .env ]; then
  : > .env
  echo "Generating .env with fresh secrets"
fi

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  key=${line%%=*}
  value=${line#*=}
  if ! grep -q "^${key}=" .env; then
    [ "$value" = "__GENERATE__" ] && value=$(gen)
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
done < .env.example

chmod 600 .env
