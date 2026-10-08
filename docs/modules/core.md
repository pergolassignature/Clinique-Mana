# Module `core`

**Always enabled** (`module_enabled('core')` is true; `org_modules` refuses a `core` row). Owns identity, access (roles, permissions, overrides), the module registry, the clinic's settings (identity, tax, signatory, bank, region, Loi 25), secrets and the audit log.

**Migrations:**
- Phase 1: `20261007140517_core_access`, `20261007140623_core_audit`, `20261007140741_core_module_settings_secrets`;
- Phase 2: `20261007192359_core_roles_split`, `20261007202941_core_organization_profile`, `20261007204045_core_tax_rates`, `20261007205802_core_bank_details`, `20261007211509_core_user_admin`, `20261007213617_core_audit_viewer`, `20261007223946_core_profile_display_name`, `20261008011138_core_org_province_default_qc`, `20261008011657_core_clear_permission_overrides`, `20261008015825_core_editable_roles`.

**Tests:** `supabase/tests/database/000_invariants.test.sql` → `014_core_editable_roles.test.sql` (one file per migration).
**Rules:** [database conventions](../standards/database-conventions.md) · **Decisions:** [ADR 0002](../adr/0002-permissions-model.md), [0003](../adr/0003-module-and-settings-registry.md), [0004](../adr/0004-secrets-in-vault.md), [0006](../adr/0006-session-and-recovery-policy.md), [decisions log](../plans/2026-10-07-decisions-log.md) #22–#40a · **Design:** [Phase 2](../plans/2026-10-07-phase-2-core-settings-design.md)

## Tables

Clients (`authenticated`) get `SELECT` only, plus the column-level `UPDATE`s listed. `anon` gets nothing. Rows are filtered by RLS. Every other write goes through an RPC.

| Table | Key columns | Client access (RLS) | Audited |
|---|---|---|---|
| `modules` | `key` pk, `name` (French label) | read all | no (git) |
| `module_dependencies` | `(module_key, depends_on)`, no `core`, acyclic (trigger) | read all | no (git) |
| `organizations` | see [below](#organizations-columns) | read own org; column `UPDATE` with `settings.manage` | yes |
| `roles` | `key` pk, `name`, `is_system`, `org_id` (null = base role, shared; set = the clinic's custom role) | read base roles and own org's | yes (from `core_editable_roles`) |
| `permissions` | `key` pk, `module_key` (prefix must equal it unless `core`), `description` | read all | no (git) |
| `role_permissions` | `(role, permission_key)`: the **template**, copied into each new org and propagated row by row when a migration adds a row | read all | no (git) |
| `org_role_permissions` | `(org_id, role, permission_key)`: the role defaults that `has_permission` evaluates | read own org; service_role read only | yes |
| `profiles` | `user_id` pk → `auth.users`, `org_id`, `display_name` (1–80 chars, non-blank), `email` (from `auth.users`, unique `lower(email)`), `status` (`active`/`disabled`) | read self, or the org with `users.view`; update own `display_name` while active | yes |
| `user_roles` | `user_id` pk, `org_id`, `role` → `roles` (a base role or one of the org's) | read self, or the org with `users.view` | yes |
| `user_permission_overrides` | `(user_id, permission_key)`, `org_id`, `granted`, `created_by`; never on an admin (trigger) | read self, or the org with `users.view` | yes |
| `tax_rates` | `id`, `org_id`, `tax` (`gst`/`qst`), `rate` numeric(7,6) in [0, 1), `effective_from`, `effective_to` (null = open), `created_by`; periods never overlap (`btree_gist` exclusion) | read own org (every member) | yes |
| `organization_bank_details` | `org_id` pk, `institution_number` (3 digits), `transit_number` (5), `account_number` **bytea, encrypted**, `account_last4`, `etransfer_email`, `updated_by` | **none**, service_role included | yes, every bank value redacted |
| `org_modules` | `(org_id, module_key)`, `enabled`, `updated_at`, `updated_by` | read own org | yes |
| `org_module_settings` | `(org_id, module_key)`, `settings` jsonb object | read own org with `settings.view` | yes |
| `org_secrets` | `(org_id, key)`, `vault_secret_id`, `version` | **none** (a select raises 42501) | yes, `vault_secret_id` redacted |
| `audit_log` | `id`, `org_id`, `table_name`, `record_id`, `action` (`insert`/`update`/`delete`/`read`), `changed_fields`, `actor_id`, `actor_role`, `source` | read own org with `audit.view`; immutable for every role | — |

`user_roles` and `user_permission_overrides` reference `profiles(user_id, org_id)` (composite FK, on delete cascade). Actor columns reference `profiles(user_id) on delete set null`.

### `organizations` columns

| Group | Columns | Database check |
|---|---|---|
| Base | `name` (« nom commercial »), `timezone` (in `pg_timezone_names`), `default_locale`, `currency` | Phase 1 |
| Identité légale | `legal_name`, `neq`, `address_line1`, `address_line2`, `city`, `province` (default `QC`, #38), `postal_code`, `country` (`CA`, no UI), `phone`, `email`, `website` | NEQ 10 digits; 13 province codes; `A1A 1A1`; `+1` + 10 digits; `https://` |
| Fiscalité | `gst_number`, `qst_number` | `^[0-9]{9}RT[0-9]{4}$`, `^[0-9]{10}TQ[0-9]{4}$` |
| Signataire | `signatory_name`, `signatory_title` | non-blank, ≤ 120 |
| Confidentialité | `privacy_officer_name`, `privacy_officer_email`, `privacy_policy_url`, `record_retention_years` | retention 1–50 |

Each column has a column-level `UPDATE` grant, under the `organizations_update` policy (`settings.manage`). The checks repeat the Zod schemas of `src/core/settings/organization/schemas.ts` and use `[0-9]`, never `\d` (ICU matches non-ASCII digits). Every member can read them, providers included: they appear on contracts and invoices.

### Bank details (ADR 0004)

The account number is encrypted with pgcrypto (`pgp_sym_encrypt`, AES-256) under the Vault secret `pii_encryption_key`, created by the migration. `private.pii_key()`, `encrypt_pii(text)` and `decrypt_pii(bytea)` are granted to no role: they only work inside the `security definer` RPCs. The audit trigger redacts every bank column (decision #31): the journal shows that the details changed, never their values. Phase 4 reuses the helpers for SINs and professionals' bank accounts, after the key management of ADR 0004 « Before Phase 4 ».

## Public RPCs (schema `public`)

All are callable by `authenticated` only unless noted. The permission check comes first (`42501`); user-facing refusals are French `P0001`.

**Access and modules**

| Function | Needs | Does |
|---|---|---|
| `get_my_access() → jsonb` | — (also service_role) | `user_id, org_id, org_name, org_timezone, display_name, email, status, role, permissions, modules`. `null` without a profile; `permissions` and `modules` empty unless the profile is active. Permissions come from the org's defaults (`org_role_permissions`) plus overrides; permissions of disabled modules are left out. |
| `module_enabled(p_key) → boolean` | — (also service_role) | true for `core` or a module enabled in the caller's org |
| `list_modules() → (key, name, depends_on[], enabled)` | — (also service_role) | catalogue (without `core`) with the caller's org state |
| `set_module_enabled(p_key, p_enabled)` | `modules.manage` | locks the org row; refuses `core` and unknown keys (`22023`), a missing dependency or an enabled dependent (`P0001`, module names) |
| `module_enabled_for_org(p_org_id, p_key) → boolean` | **service_role only** | module gate for functions without a user (webhooks, cron); the org comes from a database row |

**Secrets**

| Function | Needs | Does |
|---|---|---|
| `set_org_secret(p_key, p_value)` | `settings.manage` | creates or rotates the Vault secret, bumps `version`, audits the rotation (`rpc:set_org_secret`) |
| `delete_org_secret(p_key)` | `settings.manage` | removes the row and the Vault secret |
| `list_org_secret_keys() → (key, updated_at)` | `settings.view` | key names only |
| `get_org_secret(p_org_id, p_key) → text` | **service_role only** | decrypted value, for edge functions; never the PII key |

**Tax rates**

| Function | Needs | Does |
|---|---|---|
| `tax_rate_on(p_tax, p_date) → numeric` | — (invoker, RLS) | the caller's org rate in force on that date, or null. Facturation stores the applied rate on each invoice. |
| `add_tax_rate(p_tax, p_rate, p_effective_from) → uuid` | `settings.manage` | rounds to 6 decimals, closes the open rate on that date; the start must be after the open rate's start |
| `delete_tax_rate(p_id)` | `settings.manage` | the last (open) rate only, when it is not in force yet (clinic date) or was created less than 24 h ago (typo window); never a tax's first rate; reopens the previous one |

A trigger on `organizations` insert seeds GST 5 % from 2008-01-01 and QST 9.975 % from 2013-01-01; the migration seeded existing orgs (audit source `migration:core_tax_rates`).

**Bank details**

| Function | Needs | Does |
|---|---|---|
| `get_bank_details() → (institution_number, transit_number, account_last4, etransfer_email, updated_at, updated_by_name)` | `settings.bank_manage` | masked view, no row when none is stored |
| `reveal_bank_account_number() → text` | `settings.bank_manage` | the full number, and an audit row with action `read` (« Consultation » in the journal) |
| `set_bank_details(institution, transit, account, etransfer_email)` | `settings.bank_manage` | validates `^[0-9]{3}$`, `^[0-9]{5}$`, `^[0-9]{7,12}$`, encrypts, upserts |

**Users** (decision #28)

| Function | Needs | Does |
|---|---|---|
| `list_org_users() → (user_id, display_name, email, status, role, role_name, last_sign_in_at, override_count)` | `users.view` | the caller's org; `last_sign_in_at` from `auth.users` |
| `set_user_role(p_user_id, p_role)` | `users.manage` | a base role (not `provider`) or one of the org's custom roles; making someone admin deletes their overrides and asks for confirmation in the UI |
| `set_user_status(p_user_id, p_status)` | `users.manage` | `active`/`disabled`; only an admin re-enables an account |
| `set_permission_override(p_user_id, p_key, p_granted)` | `users.manage` | one exception, grant or revoke |
| `clear_permission_override(p_user_id, p_key)` | `users.manage` | removes one exception |
| `clear_permission_overrides(p_user_id) → int` | `users.manage` | « Rétablir les permissions du rôle » (#39): removes all of them atomically, returns how many |

Guards, in the database: nobody changes their own account here (« Mon compte » instead); only an admin changes an admin or makes someone admin; the `provider` role is neither given nor removed (the Professionnels module owns it); no overrides on admins (trigger, any write path); a non-admin manager never gives what she lacks (no grant, role or cleared revoke carrying a permission she does not hold); every org keeps **at least one active admin** (constraint triggers on `user_roles` and `profiles`). Disabling takes effect on the person's next request (`has_permission` and `get_my_access` check `status`); revoking their open sessions comes with the Phase 3 invitation function.

**Roles** (decisions #40, #40a)

| Function | Needs | Does |
|---|---|---|
| `set_role_permission(p_role, p_key, p_granted)` | `roles.manage` | adds or removes one default for the role in the caller's org |
| `create_role(p_name, p_copy_from default null) → text` | `roles.manage` | a custom role, key `custom_` + 8 hex, empty or copied from another role's defaults |
| `rename_role(p_role, p_name)` | `roles.manage` | custom roles only |
| `delete_role(p_role)` | `roles.manage` | custom roles only, and only when nobody holds it; its defaults go with it (cascade, audited) |

Guards: Administrateur always has every permission (its `org_role_permissions` rows cannot be changed or deleted except by cascade) and cannot be edited, renamed or deleted; Professionnel's defaults are locked until Phase 4; the 4 base roles cannot be renamed or deleted; a non-admin manager cannot add a permission she lacks, cannot copy a role that carries one (`HINT copy_from`), and cannot add permissions to her own role. Names: whitespace trimmed and collapsed, no control or invisible characters, 1–60 characters, unique per org and never a base role's name, compared as `lower(normalize(name, NFKC))`. An unknown, deleted or other org's role is the same « Ce rôle n'existe plus. » (`P0001`, `HINT role_missing`), so the UI keys on the hint and refetches.

**Audit journal**

| Function | Needs | Does |
|---|---|---|
| `list_audit_entries(p_table, p_actor, p_from, p_to, p_before_id, p_limit) → rows` | `audit.view` | the caller's org, newest first, keyset pagination on `id`, `p_limit` 1–200 (default 50); actor name only from a profile of the same org; never rows without `org_id` |
| `list_audit_actors() → (actor_id, actor_name)` | `audit.view` | people of the org who appear in its log (« Personne » filter) |

With `audit.view`, a person sees every audited change in the clinic, staff emails included; bank values and secrets are always masked (decision #37).

## Server-only functions (schema `private`, not exposed over the API)

- RLS helpers (EXECUTE for `authenticated`, `service_role`): `current_user_org_id()`, `current_user_role()`, `has_role(text)`, `has_permission(text)`, `clinic_today()`. They return null/false unless the caller's profile is active. `has_permission` = the org's role default (`org_role_permissions`), overridden by a per-user grant/revoke, and only for `core` or a module enabled in the caller's org.
- RPC helpers (EXECUTE revoked from everyone): `assert_can_manage_user(uuid)`, `assert_can_manage_roles()`, `assert_org_role(uuid, text)`, `valid_role_name(uuid, text, text)`, `pii_key()`, `encrypt_pii(text)`, `decrypt_pii(bytea)`.
- Trigger functions (EXECUTE revoked from everyone): `set_updated_at()`, `module_dependencies_no_cycle()`, `validate_org_timezone()`, `profiles_email_from_auth()`, `sync_profile_email()` (on `auth.users`), `audit_trigger()` (arguments = columns to redact), `audit_log_immutable()`, `org_secrets_delete_vault()`, `seed_org_tax_rates()`, `ensure_active_admin()`, `reject_admin_override()`, `clear_overrides_of_new_admin()`, `roles_freeze_identity()`, `check_role_org()`, `protect_admin_role_permissions()`, `seed_org_role_permissions()`, `propagate_template_role_permission()`.

Edge functions use `get_my_access()`, `module_enabled()` and `module_enabled_for_org()` through `supabase/functions/_shared/` (`verifyAuth`, `requireModule`, `requireModuleForOrg`).

## Locks

Read-check-write sequences lock rows with `for no key update` (conventions §6). **Lock order: the target's profile, then the org row**, everywhere both are taken:
- `assert_can_manage_user` locks the target profile; `set_user_role`, `set_permission_override`, `clear_permission_override` and `clear_permission_overrides` then lock the org row, before checking the caller's own permissions, so they serialize with `set_role_permission` changing the caller's role;
- the last-admin trigger runs on the profile or role row being written, then locks the org row;
- the role RPCs (`assert_can_manage_roles`), `add_tax_rate`, `delete_tax_rate` and `set_module_enabled` lock the org row only.

A new function that takes both locks must take them in this order, or it can deadlock against these.

## Permission keys

Defaults of the template (`role_permissions`), copied into each clinic; a clinic can change its own with `roles.manage`, except for Administrateur and Professionnel.

| Key | Module | Administrateur `admin` | Conseillère `counselor` | Adjointe administrative `admin_assistant` | Professionnel `provider` |
|---|---|:-:|:-:|:-:|:-:|
| `settings.view` | core | ✓ | | ✓ | |
| `settings.manage` | core | ✓ | | | |
| `settings.bank_manage` | core | ✓ | | | |
| `users.view` | core | ✓ | | | |
| `users.manage` | core | ✓ | | | |
| `roles.manage` | core | ✓ | | | |
| `modules.manage` | core | ✓ | | | |
| `audit.view` | core | ✓ | | | |
| `professionals.view` | professionals | ✓ | ✓ | ✓ | |
| `professionals.manage` | professionals | ✓ | | ✓ | |
| `professionals.matching` | professionals | ✓ | ✓ | ✓ | |
| `professionals.activate_override` | professionals | ✓ | | | |
| `professionals.settings` | professionals | ✓ | | | |
| `professionals.compensation` | professionals | ✓ | | | |
| `professionals.private` | professionals | ✓ | | | |
| `professionals.self` | professionals | ✓ | | | ✓ |

Per-user grants and revokes live in `user_permission_overrides`. Module keys may not equal a core prefix (`settings`, `users`, `roles`, `modules`, `audit`). Role labels shown in the app come from i18n (`roles.<key>`) for base roles and from `roles.name` for custom ones (`useRoleLabel`).

## Frontend

- `src/core/auth/`: session, recovery, login/forgot/reset pages (ADR 0006).
- `src/core/access/`: `AccessProvider`, `useAccess`, `useReadyAccess`, guards `RequireAuth` / `RequireAccess`; `org-roles.ts` (`useOrgId`, `useOrgRoles`, `useRoleLabel`, `roleKeys`).
- `src/core/account/`: « Mon compte » (`/mon-compte`, every signed-in user): display name, email change (neutral, #38), password (with reauthentication code), « Se déconnecter de tous les appareils » (#33).
- `src/core/settings/`: `SettingsLayout`, `coreSettingsSections` (`sections.ts`), `paths.ts`, `visible-sections.ts`; `organization/`, `tax/`, `bank/` (api, hooks, Zod schemas); `components/` (`OrganizationCard`, `OrganizationSettingsPage`, `TaxRatesCard`, `NewTaxRateDialog`, `BankDetailsCard`/`Form`, `TimezonePicker`); `pages/` (one per section).
- `src/core/users/`: users list and sheet (`UserSheet`: role, status, one switch per permission), role matrix (`RoleMatrix`, `RoleNameDialog`, `DeleteRoleDialog`), `permissions.ts` (mirrors the database guards so the UI hides what the server would refuse).
- `src/core/audit/`: journal api/hooks, `labels.ts` (French field names and values), `period.ts`.

### Settings sections

| Section | URL | Visible with | Editable with |
|---|---|---|---|
| Identité légale | `/parametres/identite` | `settings.view` | `settings.manage` |
| Fiscalité | `/parametres/fiscalite` | `settings.view` | `settings.manage` |
| Signataire | `/parametres/signataire` | `settings.view` | `settings.manage` |
| Coordonnées bancaires | `/parametres/banque` | `settings.bank_manage` | `settings.bank_manage` |
| Région | `/parametres/region` | `settings.view` | `settings.manage` |
| Confidentialité | `/parametres/confidentialite` | `settings.view` | `settings.manage` |
| Utilisateurs et accès | `/parametres/utilisateurs` | `users.view` or `roles.manage` | `users.manage` or `roles.manage` (each tab follows its own) |
| Modules | `/parametres/modules` | `modules.manage` | `modules.manage` |
| Journal d'audit | `/parametres/journal` | `audit.view` | — |

« Paramètres » appears only when at least one section is visible (decision #19). With the defaults, the adjointe sees the clinic sections read-only and the conseillère and the professionnel see no Paramètres.
