#!/usr/bin/env bash
# Nightly Documenso database dump for every stack on the droplet
# (installed as /usr/local/bin/documenso-backup, run by /etc/cron.d/documenso-backup).
# Signed PDFs live in the database (NEXT_PUBLIC_UPLOAD_TRANSPORT=database), so the
# dump is the whole instance except .env and cert.p12 (kept by hand, see runbook).
set -euo pipefail
umask 077

KEEP_DAYS=14
STAMP=$(date -u +%Y%m%d-%H%M%S)

# <compose project dir>:<database container>
STACKS=(
  "/opt/documenso:documenso-production-database-1"
  "/opt/documenso-clinique:documenso-clinique-database-1"
)

status=0
for stack in "${STACKS[@]}"; do
  dir=${stack%%:*}
  container=${stack##*:}
  out="$dir/backups"
  mkdir -p "$out"
  chmod 0700 "$out"
  if docker exec "$container" pg_dump -U documenso -d documenso -Fc > "$out/db-$STAMP.dump.partial"; then
    mv "$out/db-$STAMP.dump.partial" "$out/db-$STAMP.dump"
    find "$out" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
  else
    rm -f "$out/db-$STAMP.dump.partial"
    echo "backup failed: $container" >&2
    status=1
  fi
done
exit "$status"
