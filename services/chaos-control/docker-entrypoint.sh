#!/bin/sh
# Zone B. Starts as root only to join the group that owns the Docker socket (its gid
# differs per host: docker on Linux, root on Docker Desktop), then runs as `node`.
set -eu
sock=/var/run/docker.sock
if [ -S "$sock" ]; then
  gid=$(stat -c %g "$sock")
  group=$(getent group "$gid" | cut -d: -f1 || true)
  if [ -z "$group" ]; then
    addgroup -g "$gid" dockersock
    group=dockersock
  fi
  addgroup node "$group" 2>/dev/null || true
else
  echo "chaos-control: no Docker socket at $sock; storage stop/start and corrupt will fail" >&2
fi
exec su-exec node "$@"
