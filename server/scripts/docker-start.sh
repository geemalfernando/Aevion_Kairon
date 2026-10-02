#!/bin/sh
# Container entrypoint for `docker compose up`: create the demo accounts, load data/ if present, start the API.
set -e
cd /app/server
tsx=node_modules/.bin/tsx
$tsx scripts/seed-users.ts
data="${DATA_DIR:-/app/data}"
if [ -f "$data/outlets.csv" ] && [ -f "$data/catalog.json" ]; then
  $tsx scripts/import-data.ts
else
  echo "No outlets.csv/catalog.json in data/: starting without outlets or vehicles (see data/README.md)."
fi
exec $tsx src/index.ts
