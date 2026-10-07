# Core schema design review (before Batch C)

**Date:** 2026-10-07 · **Scope:** plan Tasks 1.7–1.10 (core access, audit, modules/secrets, seed) · **Method:** planned SQL executed in throwaway `supabase/postgres:17.6.1.063` (staging's version) and `.106` containers with GoTrue migrations; privilege-escalation probes as `authenticated`; claims checked against Supabase docs.

**Verdict:** design sound; migrations apply cleanly. Two critical and twelve important issues found, all adopted below. The planned SQL in the plan document is **superseded** by the implemented migrations.

## Decisions

| # | Finding | Decision |
|---|---|---|
| C1 | Test 003 asserted 0 rows on `org_secrets`, but revoked privileges raise 42501 | Assert with `throws_ok('42501')` / privilege functions |
| C2 | Supabase default privileges grant ALL on new tables/sequences/functions to `anon`/`authenticated`; a provider could `TRUNCATE public.permissions cascade` (TRUNCATE bypasses RLS) | **Closed by default:** revoke default privileges in the first migration; every table `revoke all` then explicit grants (column-level for updates); `table_privs_are` tests |
| I1 | `throws_ok` on a function the role cannot EXECUTE segfaults Postgres image `.106` (supautils) | Assert function denials with `function_privs_are`; test service-role reads with `set local role service_role` |
| I2 | Audit gaps: secret rotation invisible; `user_roles` delete rows lose `org_id`; service role can edit/delete the log; `source` always `unknown` | Explicit audit row in `set_org_secret`; `org_id` on child tables (I11); immutability triggers (update/delete/truncate) with a purge switch reserved for a future retention job; default `source` derived from `auth.role()` |
| I3 | Audit trigger copies whole rows → future `*_private` tables would leak PII/ciphertext into a log readable with `audit.view` (Loi 25) | `audit_trigger(<columns to redact>)` arguments |
| I4 | `*_by → auth.users` FKs without ON DELETE block deleting a user | Actor columns reference `public.profiles(user_id) on delete set null` |
| I5 | `get_my_access()` returned permissions for disabled / role-less users while `has_permission()` refused | Empty permission list unless active with a role; also returns enabled module keys |
| I6 | Module key `professionnels` vs permission keys `professionals.*`; `permissions.module_key` unvalidated; `depends_on text[]` accepts unknown keys/cycles | **All code identifiers in English** (`professionals`); `core` registered as a module; FK + check `split_part(key,'.',1) = module_key`; `module_dependencies` table |
| I7 | `app_role` enum: new values unusable in the same transaction, never removable; conseillère vs adjointe still open | `roles` table (`key`, `name`, `is_system`) |
| I8 | SECURITY DEFINER helpers in the API-exposed `public` schema (Supabase guidance: never) | RLS helpers in schema `private`; only intended RPCs in `public` |
| I9 | `profiles.email` drifts from `auth.users.email` | Sync trigger on `auth.users` email change; unique `lower(email)` |
| I10 | Concurrent module toggles can violate dependencies | Lock the org row in `set_module_enabled` |
| I11 | No `org_id` on `user_roles` / `user_permission_overrides` (design D3) | Add `org_id` with composite FK to `profiles(user_id, org_id)` |
| I12 | `organizations` fully updatable; timezone unvalidated | Column grants; timezone validation trigger; currency check |
| Minor | FK indexes, idempotent seeds, composite-PK record ids, `enabled_by` naming, disabled users renaming themselves, orphaned Vault secrets, trigger-function EXECUTE, missing cross-org tests, seed guard | All adopted (see migrations and `docs/standards/database-conventions.md`) |

## Not verified

The `.106` segfault on amd64 / hosted; hosted logging of RPC parameters (secrets are passed as RPC arguments); whether `db reset --linked` seeds by default on CLI 2.98.2 (the plan always passes `--no-seed`).
