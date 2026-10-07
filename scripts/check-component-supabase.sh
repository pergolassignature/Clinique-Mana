#!/usr/bin/env bash
# Guardrail (ported from PS Hub): UI files (.tsx) must not use the Supabase client.
# Data access lives in api/*.ts files and is called through hooks.
# Exemption: add "// SUPABASE_ALLOWED: <reason>" (providers only).
# Type-only imports (`import type ...`) are allowed: they are erased at build time.
set -euo pipefail

[ -d src ] || { echo "src/ not found" >&2; exit 2; }

PATTERN="core/supabase(/client)?(\.tsx?)?['\"]|@supabase/supabase-js"

violations=""
while IFS= read -r file; do
  if grep -qE "SUPABASE_ALLOWED: *[^ ]" "$file"; then continue; fi
  # `|| true`: under pipefail, grep -q exiting early can SIGPIPE the first grep
  # and make the pipeline "fail", silently skipping a real violation.
  { grep -vE '^[[:space:]]*import type ' "$file" || true; } | grep -qE "$PATTERN" || continue
  violations="${violations}\n  - ${file}"
done < <(grep -rlE --include='*.tsx' "$PATTERN" src || true)

if [ -n "$violations" ]; then
  printf '%b\n' "ERROR: UI files must not import the Supabase client directly:${violations}"
  echo "Move the query to an api/*.ts file and call it through a hook."
  exit 1
fi
echo "OK: no direct Supabase access in UI files."
