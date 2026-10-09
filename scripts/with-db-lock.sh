#!/usr/bin/env bash
# One Supabase stack serves every worktree (Phase 3 and Phase 4 lanes). Only one lane may reset or
# test it at a time: run DB work as one locked unit, for example
#   scripts/with-db-lock.sh bash -c 'npm run db:reset && npm run db:test'
#
# The token is Phase 3's lock directory (P3-25, P4-46), shared by every worktree and untracked:
# `mkdir` acquires it, `rmdir` releases it, nothing goes inside. A lane taking it by hand follows the
# same protocol, so both exclude each other.
#
# Stale lock: a holder that died without `rmdir` would block every lane. A lock untouched for
# STALE_MINUTES while no database process runs (supabase CLI, pg_prove, `functions serve`) is taken
# over, with a warning. While its command runs, this script touches the directory every minute, so
# a lock it holds never looks stale, even during a long run with no database process (Playwright).
#
# DB_LOCK_MAX_WAIT_MINUTES=n gives up (exit 75) when the token is not free within n minutes.
set -euo pipefail

STALE_MINUTES=30
LOCK="$(git rev-parse --path-format=absolute --git-common-dir)/clinique-mana-db.lock"
# Serialises takeovers: two waiters never both take over, nor remove a lock another one just took.
TAKEOVER="$LOCK.takeover"
MAX_WAIT="${DB_LOCK_MAX_WAIT_MINUTES:-}"

log() { echo "[db-lock] $*" >&2; }

# Minutes since the directory was last modified; fails when it does not exist.
if stat -c %Y . >/dev/null 2>&1; then
  mtime_of() { stat -c %Y "$1" 2>/dev/null; } # GNU (Linux, CI)
else
  mtime_of() { stat -f %m "$1" 2>/dev/null; } # BSD (macOS)
fi
age_minutes() {
  local mtime
  mtime="$(mtime_of "$1")" || return 1
  echo $((($(date +%s) - mtime) / 60))
}

db_process_running() { pgrep -x supabase >/dev/null || pgrep -x pg_prove >/dev/null || pgrep -f 'functions serve' >/dev/null; }

# Succeeds only when this process now holds the token.
take_over_if_stale() {
  local age
  if ! mkdir "$TAKEOVER" 2>/dev/null; then
    # A takeover lasts milliseconds: one older than a minute was interrupted.
    if age="$(age_minutes "$TAKEOVER")" && ((age >= 1)); then rmdir "$TAKEOVER" 2>/dev/null || true; fi
    return 1
  fi
  local taken=1
  # Checked under TAKEOVER: the holder may have released the lock meanwhile.
  if age="$(age_minutes "$LOCK")" && ((age >= STALE_MINUTES)) && ! db_process_running; then
    log "WARNING: taking over a stale lock ($age min untouched, no database process running): $LOCK"
    rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null && taken=0
  fi
  rmdir "$TAKEOVER" 2>/dev/null || true
  return "$taken"
}

started=$(date +%s)
logged=0
until mkdir "$LOCK" 2>/dev/null || take_over_if_stale; do
  waited=$((($(date +%s) - started) / 60))
  if [[ -n "$MAX_WAIT" ]] && ((waited >= MAX_WAIT)); then
    log "giving up after $waited min: another lane still holds the DB token ($LOCK)"
    exit 75
  fi
  # One line when the wait starts, then one a minute.
  if ((logged == 0 || waited >= logged)); then
    log "waiting ($waited min): another lane holds the DB token ($LOCK)"
    logged=$((waited + 1))
  fi
  sleep 5
done

heartbeat=''
release() {
  if [[ -n "$heartbeat" ]]; then kill "$heartbeat" 2>/dev/null || true; fi
  rmdir "$LOCK" 2>/dev/null || log "WARNING: the lock was already gone at release: $LOCK"
}
trap release EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# `touch -c` never creates the path. The loop stops with this script, even after `kill -9`, so an
# orphan never keeps a dead lock fresh.
(while sleep 60 && kill -0 $$ 2>/dev/null; do touch -c "$LOCK" 2>/dev/null; done) &
heartbeat=$!

"$@"
