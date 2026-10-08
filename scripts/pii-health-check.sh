#!/usr/bin/env bash
# PII key health check against staging (ADR 0004 « Before Phase 4 », plan Task 4a.16).
# Called by two GitHub workflows, never by hand on a laptop:
#   - .github/workflows/supabase-migrations.yml, step « PII key health check » (after each push);
#   - .github/workflows/pii-health.yml (every day, and on demand).
# Runs `select public.pii_health_check()` through the session pooler as `postgres`, the function's
# owner (it is granted to no role). Exits 1 unless it prints `t`. Read-only. A red job is an alarm:
# it blocks nothing (Vercel deploys the app regardless). Follow docs/runbooks/pii-key-escrow.md,
# « La vérification échoue », before anyone enters a SIN or bank number.
#
# Environment (from the workflow): SUPABASE_PROJECT_ID, SUPABASE_DB_PASSWORD (masked secret),
# SUPABASE_DB_POOLER_HOST, optional SUPABASE_DB_POOLER_URL (masked secret, overrides the host),
# GITHUB_STEP_SUMMARY. Nothing is echoed: psql reads the connection from the environment.
set -euo pipefail

summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

fail() {
  echo "::error title=PII key health check::$1 Do not enter any SIN or bank number on staging until this is fixed (docs/runbooks/pii-key-escrow.md)."
  {
    echo "### PII key health check failed"
    echo "$1"
  } >>"$summary"
  exit 1
}

if [ -z "${SUPABASE_DB_PASSWORD:-}" ] || [ -z "${SUPABASE_PROJECT_ID:-}" ]; then
  fail "SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_ID are required."
fi

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null
fi

# TODO(verify-full): sslmode=require encrypts but does not authenticate the server. Moving to
# verify-full needs Supabase's root CA committed and confirmed for the shared pooler host
# (docs/plans/2026-10-07-status.md, Phase 4 Mise en service).
export PGPASSWORD="$SUPABASE_DB_PASSWORD" PGSSLMODE=require PGCONNECT_TIMEOUT=20 \
  PGAPPNAME=pii-health-check
conn=()
if [ -n "${SUPABASE_DB_POOLER_URL:-}" ]; then
  # The secret is masked as a whole; mask its password part too, in case libpq quotes a fragment
  # of a malformed URL. The URL may omit the password (PGPASSWORD supplies it).
  case "$SUPABASE_DB_POOLER_URL" in
    *://*:*@*)
      password="${SUPABASE_DB_POOLER_URL#*://}"
      password="${password%%@*}"
      password="${password#*:}"
      if [ -n "$password" ]; then echo "::add-mask::$password"; fi
      unset password
      ;;
  esac
  conn=(--dbname="$SUPABASE_DB_POOLER_URL")
else
  export PGHOST="${SUPABASE_DB_POOLER_HOST:?SUPABASE_DB_POOLER_HOST is required without SUPABASE_DB_POOLER_URL}" \
    PGPORT=5432 PGDATABASE=postgres PGUSER="postgres.$SUPABASE_PROJECT_ID"
  # Cross-check with the host `supabase link` resolved for this project, when it wrote one. -n and
  # /p: a line that does not match prints nothing (never the whole line, which holds a URL).
  linked=$(sed -nE 's#^[a-z]+://[^@/]*@([^:/]+).*#\1#p' supabase/.temp/pooler-url 2>/dev/null || true)
  if [ -n "$linked" ] && [ "$linked" != "$PGHOST" ]; then
    echo "::warning title=PII key health check::supabase link resolved the pooler host $linked, but SUPABASE_DB_POOLER_HOST is $PGHOST. Update the workflow env."
  fi
fi

if ! result=$(psql ${conn[@]+"${conn[@]}"} --no-psqlrc --quiet --tuples-only --no-align \
                --set ON_ERROR_STOP=1 --command 'select public.pii_health_check()'); then
  fail "Could not run public.pii_health_check() on staging (connection or SQL error above)."
fi
if [ "$result" != "t" ]; then
  fail "public.pii_health_check() returned '$result', expected 't': a canary does not decrypt, or a key version that holds data has no key or no canary (see the WARNING above)."
fi
echo "PII key health check passed."
echo "### PII key health check passed" >>"$summary"
