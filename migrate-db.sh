#!/usr/bin/env bash
# Upgrade the SOL_WAR_ROOM database to the latest schema.
# Run this after pulling a new version: bash migrate-db.sh
set -e

# Resolve project root (directory this script lives in)
ROOT="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="$ROOT/artifacts/api-server/solwarroom.db"

if [ ! -f "$DB_PATH" ]; then
  echo ""
  echo "  DB not found at: $DB_PATH"
  echo "  If you moved your database, set DATABASE_PATH before running:"
  echo "    DATABASE_PATH=/path/to/solwarroom.db bash migrate-db.sh"
  echo ""
  # Honour an override if the user set DATABASE_PATH manually
  if [ -z "$DATABASE_PATH" ]; then
    exit 1
  fi
else
  export DATABASE_PATH="$DB_PATH"
fi

echo ""
echo "  SOL_WAR_ROOM — DB Migration"
echo "  DB path: $DATABASE_PATH"
echo ""

cd "$ROOT/lib/db"
npx drizzle-kit push --config ./drizzle.config.ts

echo ""
echo "  Done — database is up to date."
echo ""
