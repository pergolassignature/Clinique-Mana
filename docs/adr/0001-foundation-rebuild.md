# 0001 — Rebuild the foundation in place

**Status:** Accepted · **Date:** 2026-10-06 · **Design:** [§1, D1](../plans/2026-10-06-foundation-rebuild-design.md#1-context)

## Context
The legacy app had the right concepts but a weak base: a red build, no CI, ~1 test file, 106 migrations of which ~30 were fixes, RLS recursion workarounds, no route guards, and security holes on staging (listable invite tokens, unauthenticated edge functions). Staging holds no real data.

## Decision
- Rebuild in the **same repository** and the same staging project (`vnmbjbdsjxmpijyjmmkh`), on PS Hub's proven conventions.
- The old code moves to `_legacy/` (read-only, tag `legacy-v1`), excluded from TypeScript, ESLint, Vite and CI. A module's legacy folder is deleted once the module is rebuilt.
- Staging is wiped and re-baselined from the new migrations (plan Task 1.21), only with Jonathan's explicit go-ahead.
- Nothing is lost silently: every legacy behaviour is listed in the [inventory](../plans/2026-10-06-legacy-feature-inventory.md) and marked Keep / Change / Drop before its module is rebuilt.

## Consequences
- Git history, issues and deployment settings stay in one place; the legacy code remains a reference.
- Until a module is rebuilt and enabled, its legacy features are unavailable in the new app.
- Every module follows the same gates: pgTAP, unit tests, docs, CI green.

## Alternatives
- **New repository:** clean, but splits history and duplicates CI/deploy setup.
- **Incremental refactor of legacy:** too many cross-cutting fixes (roles, RLS, routing, tenancy) to do safely in place.
