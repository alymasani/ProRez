#!/bin/sh
# Runs once, when the Postgres data volume is first initialised.
# Creates separate databases for integration and e2e tests so they never
# touch development data.
set -eu

# Integration tests (npm run test:db) and Playwright in database mode (npm run test:e2e:db).
for DB in "${PROREZ_TEST_DB_NAME:-prorez_test}" "${PROREZ_E2E_DB_NAME:-prorez_e2e}"; do
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
SELECT 'CREATE DATABASE "$DB" OWNER "$POSTGRES_USER"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB')\gexec
SQL
done
