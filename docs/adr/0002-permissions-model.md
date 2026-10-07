# 0002 — Permissions held in the database

**Status:** Accepted · **Date:** 2026-10-06 (amended 2026-10-07) · **Design:** [§2](../plans/2026-10-06-foundation-rebuild-design.md#2-identity-roles-and-permissions) · **Review:** [core schema review](../audit/2026-10-07-core-schema-design-review.md) I5, I7, I8, I11

## Context
Legacy roles existed only in the database: no guards, no menu filtering, and policies that queried `profiles` inline (RLS recursion, twice). The clinic will add roles (conseillère vs adjointe is still open) and per-person exceptions.

## Decision
- A **catalogue** of permission keys (`permissions`, one row per key, owned by a module) and **role defaults** (`role_permissions`). Roles are a table (`roles`), not an enum.
- **Per-user overrides** (`user_permission_overrides.granted`) grant or revoke one key.
- The role is **read from `user_roles` on every check**, not from the JWT, so a change or a disabled profile takes effect immediately.
- RLS uses `private.has_permission(key)` (helpers in schema `private`, not exposed over the API). The app and edge functions read the same result through `public.get_my_access()`.
- A permission of a disabled module is false everywhere (module gate in the database).

## Consequences
- Adding a role or a key is an insert in a migration; no type changes.
- Every policy calls the helpers inside `(select …)`; never inline queries on `profiles` / `user_roles`.
- The UI hides what `can()` refuses, but only the database enforces.

## Alternatives
- **Custom JWT claims (Supabase RBAC hook):** cheaper per query, but stale until token refresh (up to 1 h after a revocation).
- **Postgres enum for roles:** new values unusable in the same transaction and never removable.
