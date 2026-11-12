#!/bin/sh
# Runs once, when the Postgres data volume is first initialised.
# Creates a separate database for integration tests so they never touch
# development data.
set -eu

TEST_DB="${PROREZ_TEST_DB_NAME:-prorez_test}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
SELECT 'CREATE DATABASE "$TEST_DB" OWNER "$POSTGRES_USER"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$TEST_DB')\gexec
SQL
