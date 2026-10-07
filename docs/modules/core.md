# Module `core`

**Always enabled** (`module_enabled('core')` is true; `org_modules` refuses a `core` row). Owns identity, access, the module registry, settings storage, secrets and the audit log.

**Migrations:** `20261007140517_core_access.sql`, `20261007140623_core_audit.sql`, `20261007140741_core_module_settings_secrets.sql`
**Tests:** `supabase/tests/database/000_invariants.test.sql` → `003_core_module_settings_secrets.test.sql`
**Rules:** [database conventions](../standards/database-conventions.md) · **Decisions:** [ADR 0002](../adr/0002-permissions-model.md), [0003](../adr/0003-module-and-settings-registry.md), [0004](../adr/0004-secrets-in-vault.md)

## Tables

Clients (`authenticated`) get `SELECT` only, plus the column-level `UPDATE`s listed. `anon` gets nothing. Rows are filtered by RLS.

| Table | Key columns | Client access (RLS) | Audited |
|---|---|---|---|
| `modules` | `key` pk, `name` (French label) | read all | no (git) |
| `module_dependencies` | `(module_key, depends_on)`, no `core`, acyclic (trigger) | read all | no (git) |
| `organizations` | `id`, `name`, `timezone` (validated), `default_locale` (`fr-CA`/`en-CA`), `currency` (`^[A-Z]{3}$`) | read own org; update `name, timezone, default_locale, currency` with `settings.manage` | yes |
| `roles` | `key` pk (`admin`, `staff`, `provider`), `name`, `is_system` | read all | no (git) |
| `profiles` | `user_id` pk → `auth.users`, `org_id`, `display_name`, `email` (from `auth.users`, unique `lower(email)`), `status` (`active`/`disabled`) | read self, or the org with `users.view`; update own `display_name` while active | yes |
| `permissions` | `key` pk, `module_key` (prefix must equal it unless `core`), `description` | read all | no (git) |
| `role_permissions` | `(role, permission_key)` — role defaults | read all | no (git) |
| `user_roles` | `user_id` pk, `org_id`, `role` → `roles` | read self, or the org with `users.view` | yes |
| `user_permission_overrides` | `(user_id, permission_key)`, `org_id`, `granted`, `created_by` | read self, or the org with `users.view` | yes |
| `org_modules` | `(org_id, module_key)`, `enabled`, `updated_at`, `updated_by` | read own org | yes |
| `org_module_settings` | `(org_id, module_key)`, `settings` jsonb object | read own org with `settings.view` | yes |
| `org_secrets` | `(org_id, key)`, `vault_secret_id`, `version` | **none** (a select raises 42501) | yes, `vault_secret_id` redacted |
| `audit_log` | `id`, `org_id`, `table_name`, `record_id`, `action`, `changed_fields`, `actor_id`, `actor_role`, `source` | read own org with `audit.view`; immutable for every role | — |

`user_roles` and `user_permission_overrides` reference `profiles(user_id, org_id)` (composite FK, on delete cascade). Actor columns reference `profiles(user_id) on delete set null`.

## Public RPCs (schema `public`)

| Function | Callable by | Does |
|---|---|---|
| `get_my_access() → jsonb` | authenticated, service_role | `user_id, org_id, org_name, org_timezone, display_name, email, status, role, permissions, modules`. `null` without a profile; `permissions` and `modules` empty unless the profile is active (and, for permissions, has a role). Permissions of disabled modules are left out. |
| `module_enabled(p_key) → boolean` | authenticated, service_role | true for `core` or a module enabled in the caller's org |
| `list_modules() → (key, name, depends_on[], enabled)` | authenticated, service_role | catalogue (without `core`) with the caller's org state |
| `set_module_enabled(p_key, p_enabled)` | authenticated, service_role | needs `modules.manage`; locks the org row; refuses `core` and unknown keys (`22023`), a missing dependency or an enabled dependent (`P0001`, French message with module names) |
| `set_org_secret(p_key, p_value)` | authenticated, service_role | needs `settings.manage`; creates or rotates the Vault secret, bumps `version`, writes an explicit audit row on rotation (`rpc:set_org_secret`) |
| `delete_org_secret(p_key)` | authenticated, service_role | needs `settings.manage`; removes the row and the Vault secret |
| `list_org_secret_keys() → (key, updated_at)` | authenticated, service_role | key names only, with `settings.view` |
| `get_org_secret(p_org_id, p_key) → text` | **service_role only** | decrypted value, for edge functions |

## Server-only functions (schema `private`, not exposed over the API)

- RLS helpers (EXECUTE for `authenticated`, `service_role`): `current_user_org_id()`, `current_user_role()`, `has_role(text)`, `has_permission(text)`. They return null/false unless the caller's profile is active; `has_permission` = role default, overridden by a per-user grant/revoke, and only for `core` or a module enabled in the caller's org.
- Trigger functions (EXECUTE revoked from everyone): `set_updated_at()`, `module_dependencies_no_cycle()`, `validate_org_timezone()`, `profiles_email_from_auth()`, `sync_profile_email()` (on `auth.users`), `audit_trigger()` (trigger arguments = columns to redact), `audit_log_immutable()`, `org_secrets_delete_vault()`.

Edge functions use `get_my_access()` and `module_enabled()` through `supabase/functions/_shared/` (`verifyAuth`, `requireModule`).

## Permission keys

| Key | Module | admin | staff | provider |
|---|---|:-:|:-:|:-:|
| `settings.view` | core | ✓ | ✓ | |
| `settings.manage` | core | ✓ | | |
| `users.view` | core | ✓ | ✓ | |
| `users.manage` | core | ✓ | | |
| `modules.manage` | core | ✓ | | |
| `audit.view` | core | ✓ | | |
| `professionals.view` | professionals | ✓ | ✓ | |

Per-user grants and revokes live in `user_permission_overrides`. Module keys may not equal a core prefix (`settings`, `users`, `modules`, `audit`).

## Frontend

`src/core/`: `auth/` (session, recovery, login/forgot/reset pages), `access/` (`AccessProvider`, `useAccess`, `useReadyAccess`, `RequireAuth`, `RequireAccess`), `modules/` (manifest types, `resolveEnabledModules`, `useModules`, `useSetModuleEnabled`), `settings/` (`SettingsLayout`, `coreSettingsSections`: « Modules »).
