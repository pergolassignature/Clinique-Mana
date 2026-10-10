#!/usr/bin/env bash
# Scheduled jobs health check against production (P3-36, migration *_core_jobs_health.sql).
# Called by .github/workflows/jobs-health.yml (every hour, and on demand) after `supabase link`.
# Runs `select public.jobs_health_report()` through `supabase db query --linked` (the Management
# API, as the function's owner) and exits 1 unless the verdict is healthy, so the run turns red
# and GitHub emails the repository owner. Read-only: the report is a stable function that writes
# nothing.
#
# It prints job keys, statuses, counts, error codes and times only: the report holds nothing else
# (no org id, no run detail but a code), and every field printed below is picked by name, so a
# field added to the report later is not printed until it is listed here.
#
# Environment (from the workflow): SUPABASE_ACCESS_TOKEN (masked secret), GITHUB_STEP_SUMMARY.
# A red run: docs/modules/core.md, « Jobs health ».
set -euo pipefail

summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

fail() {
  echo "::error title=Scheduled jobs health check::$1"
  {
    echo "### Scheduled jobs health check failed"
    echo "$1"
  } >>"$summary"
  exit 1
}

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  fail "SUPABASE_ACCESS_TOKEN is required."
fi
command -v jq >/dev/null 2>&1 || fail "jq is required."

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT
if ! output=$(supabase db query --linked --agent=no -o json \
                'select public.jobs_health_report() as report' 2>"$errors"); then
  # The CLI's own message (connection, SQL error); it never holds row content.
  cat "$errors" >&2
  fail "Could not run public.jobs_health_report() on production (see the error above)."
fi

if ! report=$(jq -ce '.[0].report | objects' <<<"$output" 2>/dev/null); then
  fail "public.jobs_health_report() returned no report."
fi

# A code or a job key is printed only when it looks like one (defence in depth: the report already
# holds nothing else).
jq_code='def code: if type == "string" and test("^[A-Za-z0-9_]{1,64}$") then . else "other" end;
         def key: if type == "string" and test("^[a-z_]+\\.[a-z0-9_]+$") then . else "other" end;'

echo "Checked at $(jq -r '.checked_at' <<<"$report")"
jq -r '"Runs started in the last hour: \(.runs_last_hour) (last: \(.last_run_started_at // "never")); errors in the last 2 h: \(.errors_last_2h); configuration_missing in the last 2 h: \(.configuration_missing_last_2h)"' <<<"$report"
jq -r '"pg_cron runs in the last hour: \(.cron_runs_last_hour) (last: \(.cron_last_started_at // "never")); failed in the last 2 h: \(.cron_failed_last_2h)"' <<<"$report"

{
  echo "### Scheduled jobs"
  echo
  echo "| Job | Kind | Last success | Errors in a row | Last error | Failing | Stale |"
  echo "|---|---|---|---|---|---|---|"
  jq -r "$jq_code"' .jobs[] | "| `\(.job_key | key)` | \(.kind | code) | \(.last_success_at // "never") | \(.consecutive_errors) | \(.last_error_code // "" | if . == "" then "" else code end) | \(.failing_scopes) | \(.stale_scopes) |"' <<<"$report"
} >>"$summary"

if [ "$(jq -r '.healthy' <<<"$report")" = "true" ]; then
  echo "Scheduled jobs health check passed."
  echo "Scheduled jobs health check passed." >>"$summary"
  exit 0
fi

# One annotation per problem: its code and the job, counts and times that explain it.
problems=$(jq -r "$jq_code"' .problems[]
  | [ (.code | code),
      (if .job_key then "job=\(.job_key | key)" else empty end),
      (if .consecutive_errors then "errors_in_a_row=\(.consecutive_errors)" else empty end),
      (if .error_code then "last_error=\(.error_code | code)" else empty end),
      (if .runs then "runs=\(.runs)" else empty end),
      (if .scopes then "scopes=\(.scopes)" else empty end),
      (if has("last_started_at") then "last_started_at=\(.last_started_at // "never")" else empty end),
      (if has("last_success_at") then "last_success_at=\(.last_success_at // "never")" else empty end),
      (if .threshold_minutes then "threshold_minutes=\(.threshold_minutes)" else empty end) ]
  | join(" ")' <<<"$report")
{
  echo
  echo "### Problems"
  echo
  while IFS= read -r line; do echo "- \`$line\`"; done <<<"$problems"
} >>"$summary"
while IFS= read -r line; do echo "::error title=Scheduled jobs::$line"; done <<<"$problems"
exit 1
