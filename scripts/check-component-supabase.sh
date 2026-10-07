#!/usr/bin/env bash
# Guardrail (ported from PS Hub): UI files (.tsx) must not use the Supabase client.
# Data access lives in api/*.ts files and is called through hooks.
# Exemption: add "// SUPABASE_ALLOWED: <reason>" (providers only).
set -euo pipefail

[ -d src ] || { echo "src/ not found" >&2; exit 2; }

violations=""
while IFS= read -r file; do
  if grep -qE "SUPABASE_ALLOWED: *[^ ]" "$file"; then continue; fi
  violations="${violations}\n  - ${file}"
done < <(grep -rlE --include='*.tsx' "core/supabase(/client)?['\"]|@supabase/supabase-js" src || true)

if [ -n "$violations" ]; then
  printf '%b\n' "ERROR: UI files must not import the Supabase client directly:${violations}"
  echo "Move the query to an api/*.ts file and call it through a hook."
  exit 1
fi
echo "OK: no direct Supabase access in UI files."
