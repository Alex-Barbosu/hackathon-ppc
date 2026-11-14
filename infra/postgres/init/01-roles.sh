#!/bin/sh
# Runs once on an empty data volume. Creates the read-only insights role (zone C)
# and makes every future table in public readable by it.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE insights LOGIN PASSWORD '${INSIGHTS_DB_PASSWORD}';
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO insights;
GRANT USAGE ON SCHEMA public TO insights;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public GRANT SELECT ON TABLES TO insights;
CREATE SCHEMA insights AUTHORIZATION insights;
SQL
