#!/bin/sh
# Runs as root only long enough to make the spool volume writable, then becomes "app".
set -eu
SPOOL_DIR="${FILEGRID_SPOOL_DIR:-/var/filegrid/spool}"
mkdir -p "$SPOOL_DIR"
chown app:app "$SPOOL_DIR"
exec su-exec app "$@"
