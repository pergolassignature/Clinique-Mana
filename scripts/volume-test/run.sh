#!/usr/bin/env bash
# Volume test (LOCAL ONLY, fictional data): resets the local stack with this checkout's migrations
# and seed, loads production-scale synthetic data (generate.sql), times the hot RPCs as the seed's
# admin (timing.sql, plans of the inner statements over 50 ms through auto_explain), then resets the
# stack again so no synthetic data stays. Run it under the shared-stack lock, from the repo root:
#
#   bash scripts/with-db-lock.sh bash scripts/volume-test/run.sh [tag]
#
# Writes scripts/volume-test/out/timing-<tag>.txt and plans-<tag>.log (gitignored). Never point it
# at a remote database: it only talks to the local container.
set -uo pipefail
TAG="${1:-run}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/out"
DB=supabase_db_clinique-mana
mkdir -p "$OUT"
cleanup() { cd "$ROOT" && npx supabase db reset >/dev/null 2>&1; echo "local stack reset"; }
trap cleanup EXIT
cd "$ROOT" || exit 1
npx supabase db reset 2>&1 | grep -iE 'error|finished' | tail -3
docker exec -i "$DB" psql -U postgres -d postgres -q < "$HERE/generate.sql" 2>&1 | tail -5
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# auto_explain needs the local superuser (supabase_admin, local default password).
docker exec -i -e PGPASSWORD=postgres "$DB" psql -U supabase_admin -d postgres < "$HERE/timing.sql" > "$OUT/timing-$TAG.txt" 2>&1
docker logs --since "$since" "$DB" > "$OUT/plans-$TAG.log" 2>&1
grep -E "^==|^Time:|ERROR" "$OUT/timing-$TAG.txt"
