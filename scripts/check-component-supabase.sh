#!/usr/bin/env bash
# Guardrail (ported from PS Hub): UI files (.tsx) must not use the Supabase client.
# Data access lives in api/*.ts files and is called through hooks.
# Exemption: add "// SUPABASE_ALLOWED: <reason>" (providers only).
set -euo pipefail

violations=""
while IFS= read -r file; do
  if grep -q "SUPABASE_ALLOWED" "$file"; then continue; fi
  violations="${violations}\n  - ${file}"
done < <(grep -rl --include='*.tsx' "@/core/supabase/client" src || true)

if [ -n "$violations" ]; then
  echo -e "ERROR: UI files must not import the Supabase client directly:${violations}"
  echo "Move the query to an api/*.ts file and call it through a hook."
  exit 1
fi
echo "OK: no direct Supabase access in UI files."
