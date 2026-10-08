# Module `core`

**Always enabled** (`module_enabled('core')` is true; `org_modules` refuses a `core` row). Owns identity, access (roles, permissions, overrides), the module registry, the clinic's settings (identity, tax, signatory, bank, region, Loi 25), secrets and the audit log, and, since Phase 3, the **shared services** every module uses: scheduled jobs, email, in-app notifications, secure links and staff invitations, private file storage, e-signature with the server-side PDF renderer, rate limits and webhook claims ([below](#shared-services-phase-3)).

**Migrations:**
- Phase 1: `20261007140517_core_access`, `20261007140623_core_audit`, `20261007140741_core_module_settings_secrets`;
- Phase 2: `20261007192359_core_roles_split`, `20261007202941_core_organization_profile`, `20261007204045_core_tax_rates`, `20261007205802_core_bank_details`, `20261007211509_core_user_admin`, `20261007213617_core_audit_viewer`, `20261007223946_core_profile_display_name`, `20261008011138_core_org_province_default_qc`, `20261008011657_core_clear_permission_overrides`, `20261008015825_core_editable_roles`;
- Phase 3: `20261008033613_core_shared_permissions`, `20261008034408_core_rate_limits_webhook_events`, `20261008035350_core_has_permission_plpgsql`, `20261008040525_core_scheduled_jobs`, `20261008050047_core_email`, `20261008051801_core_notifications`, `20261008060945_core_secure_links`, `20261008062413_core_staff_invitations`, `20261008071750_core_storage`, `20261008073909_core_signing`, `20261008074035_core_staff_access_followups`, `20261008082519_core_signing_function_support`. Each migration's header states its key choices; read it before changing the area.

**Tests:** `supabase/tests/database/000_invariants.test.sql` → `025_core_signing_function_support.test.sql` (one file per migration; `003` holds the exact `functions_are` list of `public`). Edge functions: `npm run test:functions` (Deno, `supabase/functions/**`).
**Rules:** [database conventions](../standards/database-conventions.md) · **Decisions:** [ADR 0002](../adr/0002-permissions-model.md), [0003](../adr/0003-module-and-settings-registry.md), [0004](../adr/0004-secrets-in-vault.md), [0005](../adr/0005-documenso-replaces-docuseal.md), [0006](../adr/0006-session-and-recovery-policy.md), [0007](../adr/0007-secure-links-and-public-token-functions.md), [0008](../adr/0008-server-side-pdf-rendering.md), [decisions log](../plans/2026-10-07-decisions-log.md) #22–#40a and P3-1–P3-34 · **Design:** [Phase 2](../plans/2026-10-07-phase-2-core-settings-design.md), [Phase 3](../plans/2026-10-08-phase-3-shared-services-design.md) ([plan](../plans/2026-10-08-phase-3-shared-services-plan.md))

## Tables

Clients (`authenticated`) get `SELECT` only, plus the column-level `UPDATE`s listed. `anon` gets nothing. Rows are filtered by RLS. Every other write goes through an RPC.

| Table | Key columns | Client access (RLS) | Audited |
|---|---|---|---|
| `modules` | `key` pk, `name` (French label) | read all | no (git) |
| `module_dependencies` | `(module_key, depends_on)`, no `core`, acyclic (trigger) | read all | no (git) |
| `organizations` | see [below](#organizations-columns); since Phase 3 also `logo_file_id`, `signature_file_id` → `stored_files` (set by `set_org_asset` only) | read own org; column `UPDATE` with `settings.manage` | yes |
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
| `set_org_secret(p_key, p_value)` | `settings.integrations_manage` (P3-12; `settings.manage` before Phase 3) | creates or rotates the Vault secret, bumps `version`, audits the rotation (`rpc:set_org_secret`) |
| `delete_org_secret(p_key)` | `settings.integrations_manage` | removes the row and the Vault secret |
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
| `set_user_status(p_user_id, p_status)` | `users.manage` | `active`/`disabled`; only an admin re-enables an account. Disabling also deletes the person's `auth.sessions` (refresh tokens cascade) in the same transaction, on every disable call (P3-32); the `users-set-status` function adds the Auth ban (P3-9). |
| `set_permission_override(p_user_id, p_key, p_granted)` | `users.manage` | one exception, grant or revoke |
| `clear_permission_override(p_user_id, p_key)` | `users.manage` | removes one exception |
| `clear_permission_overrides(p_user_id) → int` | `users.manage` | « Rétablir les permissions du rôle » (#39): removes all of them atomically, returns how many |

Guards, in the database: nobody changes their own account here (« Mon compte » instead); only an admin changes an admin or makes someone admin; the `provider` role is neither given nor removed (the Professionnels module owns it); no overrides on admins (trigger, any write path); a non-admin manager never gives what she lacks (no grant, role or cleared revoke carrying a permission she does not hold); every org keeps **at least one active admin** (constraint triggers on `user_roles` and `profiles`). Disabling takes effect on the person's next request (`has_permission` and `get_my_access` check `status`); their sessions end in the same transaction (P3-32), and the UI disables through `users-set-status`, which also bans the account in Auth so no new sign-in succeeds. An access token already issued lives until it expires (≤ 1 h) but carries no permission.

**Roles** (decisions #40, #40a)

| Function | Needs | Does |
|---|---|---|
| `set_role_permission(p_role, p_key, p_granted)` | `roles.manage` | adds or removes one default for the role in the caller's org |
| `create_role(p_name, p_copy_from default null) → text` | `roles.manage` | a custom role, key `custom_` + 8 hex, empty or copied from another role's defaults |
| `rename_role(p_role, p_name)` | `roles.manage` | custom roles only |
| `delete_role(p_role)` | `roles.manage` | custom roles only, and only when nobody holds it and no **pending staff invitation** names it (French message, inconsistency #15); its defaults go with it (cascade, audited) |

Guards: Administrateur always has every permission (its `org_role_permissions` rows cannot be changed or deleted except by cascade) and cannot be edited, renamed or deleted; Professionnel's defaults are locked until Phase 4; the 4 base roles cannot be renamed or deleted; a non-admin manager cannot add a permission she lacks, cannot copy a role that carries one (`HINT copy_from`), and cannot add permissions to her own role. Names: whitespace trimmed and collapsed, no control or invisible characters, 1–60 characters, unique per org and never a base role's name, compared as `lower(normalize(name, NFKC))`. An unknown, deleted or other org's role is the same « Ce rôle n'existe plus. » (`P0001`, `HINT role_missing`), so the UI keys on the hint and refetches.

**Audit journal**

| Function | Needs | Does |
|---|---|---|
| `list_audit_entries(p_table, p_actor, p_from, p_to, p_before_id, p_limit) → rows` | `audit.view` | the caller's org, newest first, keyset pagination on `id`, `p_limit` 1–200 (default 50); actor name only from a profile of the same org; never rows without `org_id` |
| `list_audit_actors() → (actor_id, actor_name)` | `audit.view` | people of the org who appear in its log (« Personne » filter) |

With `audit.view`, a person sees every audited change in the clinic, staff emails included; bank values and secrets are always masked (decision #37).

## Server-only functions (schema `private`, not exposed over the API)

- RLS helpers (EXECUTE for `authenticated`, `service_role`): `current_user_org_id()`, `current_user_role()`, `has_role(text)`, `current_permission_keys()`, `has_permission(text)`, `clinic_today()`. They return null/false/`'{}'` unless the caller's profile is active. **`current_permission_keys()` is the one place permissions are evaluated** (P3-21): the org's role defaults (`org_role_permissions`) plus granted overrides minus revoked ones, only for `core` and the modules enabled in the caller's org, sorted. `has_permission(k)` is `k = any (current_permission_keys())` (plpgsql, so its plan is cached), and `get_my_access().permissions` reads the same function. A policy whose key comes from the row tests `col = any ((select private.current_permission_keys())::text[])` (conventions §5). `permission_keys_for(uuid)` is the same body for any user (granted to no role: the service RPCs with an explicit actor use it).
- Phase 3 helpers for module RPCs (EXECUTE granted to no role; called from inside `security definer` RPCs only): `notify(…)` (a notice; same contract as `create_notification`), `issue_secure_link(org, purpose, subject_type, subject_id, token_hash, created_by, ttl, scope)`, `consume_secure_link(token_hash, purpose)`, `revoke_secure_links(org, purpose, subject_type, subject_id, by)`, `attach_stored_file(file, purposes[], subject_type, subject_id, view_permission, owner_profile_id, owner_permission, uploaded_by)`, `soft_delete_stored_file(file, by)`. Jobs: `run_sql_job(key, trigger)`, `invoke_job_function(key, org, trigger)`, `job_due(…)`, `list_job_orgs_at(…)`, `start_job_run_at(…)` and the `job_*()` maintenance bodies. Checks and validators: `email_placeholder_error`, `email_variables_valid`, `email_variable_paths`, `email_sender_name`, `is_mailbox`, `mime_extension` (SQL twin of `_shared/storage.ts` FORMATS), `permission_in_module`, `signing_base_url_valid` / `signing_base_url_origin` (P3-34), `signing_signers_valid`, `signing_recipients_valid`, `signing_superseded`, `staff_inviter`, `assert_can_invite_to_role`.
- RPC helpers (EXECUTE revoked from everyone): `assert_can_manage_user(uuid)`, `assert_can_manage_roles()`, `assert_org_role(uuid, text)`, `valid_role_name(uuid, text, text)`, `pii_key()`, `encrypt_pii(text)`, `decrypt_pii(bytea)`.
- Trigger functions (EXECUTE revoked from everyone): `set_updated_at()`, `module_dependencies_no_cycle()`, `validate_org_timezone()`, `profiles_email_from_auth()`, `sync_profile_email()` (on `auth.users`), `audit_trigger()` (arguments = columns to redact; under the service role it attributes the write to `app.audit_actor` when an RPC sets it), `audit_log_immutable()`, `org_secrets_delete_vault()`, `seed_org_tax_rates()`, `ensure_active_admin()`, `reject_admin_override()`, `clear_overrides_of_new_admin()`, `roles_freeze_identity()`, `check_role_org()`, `protect_admin_role_permissions()`, `seed_org_role_permissions()`, `propagate_template_role_permission()`; Phase 3: `seed_org_scheduled_jobs()`, `propagate_scheduled_job()`, `seed_org_email_settings()`, `seed_org_signing_settings()`, `check_upload_purpose()`, `check_stored_file_module_gate()`, `guard_template_version()`, `guard_template_version_delete()`.

Edge functions use `get_my_access()`, `module_enabled()` and `module_enabled_for_org()` through `supabase/functions/_shared/` (`verifyAuth`, `requireModule`, `requireModuleForOrg`).

## Locks

Read-check-write sequences lock rows with `for no key update` (conventions §6). **Lock order: the target's profile, then the org row**, everywhere both are taken:
- `assert_can_manage_user` locks the target profile; `set_user_role`, `set_permission_override`, `clear_permission_override` and `clear_permission_overrides` then lock the org row, before checking the caller's own permissions, so they serialize with `set_role_permission` changing the caller's role;
- the last-admin trigger runs on the profile or role row being written, then locks the org row;
- the role RPCs (`assert_can_manage_roles`), `add_tax_rate`, `delete_tax_rate` and `set_module_enabled` lock the org row only.

A new function that takes both locks must take them in this order, or it can deadlock against these.

**Phase 3 lock orders** (each migration header has the detail):
- **Staff invitations:** every writer of an org's invitations takes the **org row first**. `create_staff_invitation`: org → the link's advisory lock (org, purpose, subject) → link rows → the new invitation. `renew_staff_invitation` / `revoke_staff_invitation`: org → the invitation → its link(s). `accept_staff_invitation`: reads the link's org unlocked, then org → the link (consumed by one `update`) → the invitation. `delete_role` takes the org row (`assert_can_manage_roles`) before its pending-invitation check, so it serialises with them. The purge job `core.secure_links_purge` takes no org lock (link, then the invitation through `on delete set null`); it can only meet a renew or revoke of an invitation whose link expired a year ago, and Postgres then aborts one side (retryable).
- **Secure links:** `issue_secure_link` takes a transaction advisory lock on (org, purpose, subject) before revoking the previous link, so concurrent issues serialise (the last one wins) instead of failing on the unique live-link index.
- **Org assets:** `set_org_asset` locks the org row, then updates the new `stored_files` row and soft-deletes the old one (org → files). A module RPC that attaches files locks its own row first, then `attach_stored_file` locks the file.
- **Document templates:** `create_template_version`, `update_template_version`, `publish_template_version`, `archive_template_version` lock the **template row**, then the version (publish archives the previous published version under the template lock).
- **Signature requests:** one row lock per request (`for update`): `begin_signature_request_send` (the send claim), `mark_signature_request_sent`, `recover_signature_request`, `complete_signature_request`, `cancel_signature_request`, `apply_signing_event`. None takes another table's lock first.
- **Signing settings:** `set_signing_settings` locks the org's `signing_settings` row, then deletes `documenso_api_key` (`org_secrets`) when the origin changed. `set_org_secret` locks the `org_secrets` row only.
- **Jobs:** `start_job_run` serialises per (job, org) on a transaction advisory lock (overlap guard); the reconcile job claims dispatches with `for update skip locked`.
- **Email:** `apply_email_event` locks the one `email_log` row. **Webhook claims** and **rate limits** rely on the row lock of their upsert (no explicit lock).

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
| `settings.email_manage` | core | ✓ | | | |
| `settings.integrations_manage` | core | ✓ | | | |
| `professionals.view` | professionals | ✓ | ✓ | ✓ | |

Per-user grants and revokes live in `user_permission_overrides`. Module keys may not equal a core prefix (`settings`, `users`, `roles`, `modules`, `audit`). `settings.email_manage` (Phase 3): the sender, the templates and the clinic-wide send history (« Courriels »). `settings.integrations_manage` (P3-12): integration keys and addresses (`set_org_secret` / `delete_org_secret`, the sending domain, « Signature électronique »). Role labels shown in the app come from i18n (`roles.<key>`) for base roles and from `roles.name` for custom ones (`useRoleLabel`).

## Shared services (Phase 3)

Built in Phase 3 ([design](../plans/2026-10-08-phase-3-shared-services-design.md), [plan](../plans/2026-10-08-phase-3-shared-services-plan.md), decisions P3-1–P3-34). Every piece runs locally with fakes (Mailpit, the fake Documenso, `supabase/functions/.env`); nothing needs a real key to build or test.

### Tables

Same rules as above: closed grants, RLS through `private` helpers, `SELECT` only for clients. **Catalogues** are global, seeded by migrations of the owning module and not audited (git is their history); **operational logs** are not audited either (conventions §7, `000_invariants`).

| Table | What | Client access (RLS) | Audited |
|---|---|---|---|
| `rate_limits` | `(bucket, key_hash, window_start)`, `hits`; HMAC-hashed keys, fixed windows ≤ 24 h | none | no (operational, no `org_id`) |
| `webhook_events` | `(provider, event_id)` unique, `org_id`, `event_type`, `status`, lease (`claim_token`, `lease_expires_at`), `payload` (ids only, cleared on completion), `error` (a code) | none | no (operational) |
| `scheduled_jobs` | catalogue: `key` `<module>.<name>`, `kind` `sql` (`private.job_*`) or `function` (an edge function), `cron_job_name`, `local_hour`, `is_maintenance`, `is_active` | read all | no (catalogue) |
| `org_scheduled_jobs` | `(org_id, job_key)`, `enabled`: a row per org × job (triggers); maintenance jobs always on, business jobs start off | read own org with `settings.view` | yes |
| `scheduled_job_runs` | `job_key`, `org_id` (null for a database-wide SQL job), `trigger` (`cron`/`manual`), `status` (`running`/`ok`/`error`/`skipped`), `detail` (counts or a code, ≤ 500), `run_local_date` (unique per job, org and clinic day) | own org or database-wide, with `settings.view` | no (operational) |
| `scheduled_job_dispatches` | one row per `pg_net` post (request id), reconciled by `core.scheduled_jobs_reconcile` | none | no (operational) |
| `email_template_defaults` | catalogue: `key` `<module>.<name>`, label, `why_line`, subject, body, `button_label`, `variables`, `view_permission`, `recipient_mode` (`subject`/`free`), `allows_attachments` (P3-18) | read all | no (catalogue) |
| `email_templates` | `(org_id, key)`: the clinic's override (subject, body, button), `version` from 1 | read own org with `settings.view` | yes |
| `email_template_versions` | `(org_id, key)`, `last_version`: the counter that survives a reset, so a version number is never reused | none | yes |
| `email_settings` | one row per org: `from_name`, `from_address`, `reply_to`, `sending_domain` | read own org with `settings.view` | yes |
| `email_log` | one row per message: template key and version, `to_email` (nulled after 24 months), `to_profile_id`, subject, `status`, `error_code`, `resend_id`, `view_permission`, `sent_by`; **no body or rendered subject** | own org, and the row's `view_permission` or `settings.email_manage` | no (operational) |
| `notifications` | `module_key`, `kind` `<module>.<name>`, `importance` (`normal`/`important`), French `title` / `body`, app-relative `link_path`, subject, `recipient_permission`, optional `recipient_user_id`, `dedupe_key` (unique per org and kind), `expires_at` | own org, `recipient_permission` held (array form), and the user when narrowed | no (operational) |
| `notification_reads` | `(notification_id, user_id)` | none (the RPCs return `is_read`) | no (operational) |
| `secure_link_purposes` | catalogue: `key`, `module_key`, TTLs, `max_uses`, `creates_account`, `resolve_rpc`, `accept_rpc`, `view_permission` | none (service role included) | no (catalogue) |
| `secure_links` | `token_hash` (SHA-256, 32 bytes, unique), org, purpose, subject, `max_uses` / `use_count`, `expires_at`, `used_at`, `revoked_at`, `last_opened_at`; one live link per (org, purpose, subject) | none (service role included) | yes, `token_hash` redacted |
| `staff_invitations` | `email`, `display_name`, `role`, `secure_link_id`, `status` (`pending`/`accepted`/`revoked`), `invited_by`, `accepted_user_id`; one pending invitation per (org, address) | read own org with `users.view` | yes |
| `upload_purposes` | catalogue: `key`, `module_key`, `bucket`, `upload_permission`, `view_permission`, `owner_permission`, `max_bytes`, `mime_types`, `max_image_side`, `retain_days` | read all | no (catalogue) |
| `stored_files` | the file registry: `bucket`, `object_path` (`{org}/{module}/{subject}/{file_id}.{ext}`, built by the database), purpose, subject, `owner_profile_id` / `owner_permission`, `view_permission` (null = any active member, core purposes only), `original_name`, `mime_type`, `size_bytes`, `sha256`, `status` (`pending`/`ready`/`deleted`/`purged`, P3-30), `retain_until` (staged, P3-17) | own org, `ready`, and the view permission (array form) or null, or the owner branch | yes, `original_name` redacted |
| `signing_settings` | one row per org: `base_url` (P3-34), `expiry_days` (1–60, default 7: Documenso's envelope expiry and the reconcile) | read own org with `settings.view` | yes |
| `document_templates` | `(org_id, key)`, `module_key`, title, `view_permission`, `edit_permission` (both permissions of the module: composite FKs), `is_active` | own org with `view_permission` (array form) | yes |
| `document_template_versions` | `version`, `status` (`draft` → `published` → `archived`), `body` (the renderer's `PdfDocument`, ≤ 256 KB), `variables`, `signers` (≤ 3 roles: `professional`, `clinic`, `client`), Documenso email subject and message | through the template's `view_permission` | yes, `body` redacted |
| `signature_requests` | module, purpose, subject, template version (null only for the built-in test document), `title`, `status`, Documenso document and envelope ids, `superseded_document_ids`, `send_started_at` / `last_send_at` (the claim), `idempotency_key`, source and signed files, `view_permission`, `last_error`, timestamps per event | own org with `view_permission` (array form) | yes, `title` and `rejection_reason` redacted |
| `signature_request_signers` | per request and role: order, name, `email`, Documenso recipient id, `status` (`pending` → `viewed` → `signed`/`rejected`) | every column **but `email`**, through the request's permission | yes, name and email redacted |

### RPCs

Service-role RPCs are called by edge functions only (`grant execute … to service_role`); user RPCs by the app (`authenticated`). The permission check comes first (`42501`); user-facing refusals are French `P0001`. Read RPCs that RLS can gate are `security invoker` and keyset-paged (`p_before` + `p_before_id`, `p_limit` clamped).

| Area | User RPCs (needs) | Service-role RPCs |
|---|---|---|
| Rate limits, webhooks | `last_webhook_event_at(p_provider)` (`settings.view`: « Dernier événement reçu ») | `consume_rate_limit(bucket, key_hash, max, window_s)`, `claim_webhook_event(provider, event_id, org, type, payload, lease_s)`, `complete_webhook_event(id, token)`, `fail_webhook_event(id, token, code)` |
| Jobs | `list_scheduled_jobs()` (`settings.view`), `list_scheduled_job_runs(job, limit, before, before_id)` (invoker, `settings.view`), `set_scheduled_job_enabled(key, enabled)` and `run_scheduled_job_now(key)` (`settings.manage`; business jobs only for the switch) | `list_job_orgs(key)`, `start_job_run(key, org, trigger)` (null when not due or a run is under way), `finish_job_run(id, status, detail)` |
| Email | `set_email_sender(name, address, reply_to)`, `save_email_template(key, subject, body, button)`, `reset_email_template(key)` (`settings.email_manage`); `set_email_sending_domain(domain)` (`settings.integrations_manage`); `list_email_templates()` (`settings.view`); `list_email_log(template, status, from, to, before, limit, before_id)` (invoker, RLS); `list_subject_emails(subject_type, subject_id, limit)` (definer, the same rows as the policy, with the sender's name; P3-26) | `get_email_context(org, key)`, `queue_email(…)`, `mark_email_sent(id, resend_id, attempts)`, `mark_email_failed(id, code, attempts)`, `apply_email_event(org, email_log_id, resend_id, status, at)` (checks the row's module itself → `ignored`), `count_org_emails_today(org)` |
| Notifications | `list_my_notifications(before, limit, importance, unread_only, before_id)` (20 by default, ≤ 50), `count_my_unread_notifications()` → `(total, important)` over 90 days, `mark_notifications_read(ids[])`, `mark_all_notifications_read()` | `create_notification(…)` (functions; `_shared/notifications.ts` `notify`) |
| Secure links, invitations | `list_staff_invitations()` (`users.view`; last email status and error code), `revoke_staff_invitation(id)` (`users.manage`) | `peek_secure_link(token_hash, mark_opened)`; `create_staff_invitation(p_actor, email, name, role, token_hash)` → `(id, expires_at)`, `renew_staff_invitation(p_actor, id, token_hash)`, `resolve_staff_invitation(link_id)` and `accept_staff_invitation(token_hash, user_id, payload)` (the `staff_invite` purpose's handlers) |
| Storage | `create_pending_upload(purpose, subject_type, subject_id, name, mime, size)` (the purpose's `upload_permission`), `get_pending_upload(file_id)` (the uploader), `set_org_asset(kind, file_id)` (`settings.manage`: logo or signature) | `confirm_stored_file(id, sha256, size)`, `reject_stored_file(id)`, `register_system_file(org, bucket, module, purpose, subject_type, subject_id, mime, size, sha256, view_permission, name)`, `discard_system_file(org, id)`, `list_files_to_purge(org, limit)`, `mark_files_purged(org, ids[])` |
| Signing | `set_signing_settings(p jsonb)` (`settings.integrations_manage`; a per-field patch, returns whether the key was cleared); `create_document_template(…)`, `set_document_template_active(id, active)` (`settings.manage`); `create_template_version`, `update_template_version`, `publish_template_version`, `archive_template_version` (the template's `edit_permission`); `list_document_templates(module)`, `list_subject_signature_requests(subject_type, subject_id, limit, before, before_id)`, `get_signature_request(id)` (invoker, RLS) | `get_signing_context(org, version)`, `create_signature_request(p jsonb)`, `begin_signature_request_send(org, id, stale_after)`, `mark_signature_request_sent(…)`, `mark_signature_request_failed(id, code, doc, envelope)`, `apply_signing_event(org, request, doc, event, recipient, at, reason)`, `complete_signature_request(id, file, sha256)`, `recover_signature_request(org, id, doc, envelope, recipients)`, `get_signing_request(org, id)`, `list_signature_requests_to_reconcile(org, limit)`, `expire_signature_request(id)`, `cancel_signature_request(id, by)` |

### Jobs and schedules

`pg_cron` runs every schedule (UTC). A `sql` job calls `private.run_sql_job` (database-wide, always maintenance); a `function` job calls `private.invoke_job_function`, which posts to the edge function through `pg_net` with `X-Job-Signature` (HMAC of `<t>.<job_key>.<org or ''>.<trigger>` with the Vault secret `internal_function_secret`, at the Vault `project_url`; never the raw secret, CLAUDE.md §7). The function loops over `list_job_orgs` and logs each org's run (`start_job_run` / `finish_job_run`, `_shared/jobs.ts` `runJob`). A business job may run at a clinic-local hour (`local_hour`, P3-22): scheduled hourly, due once that hour has passed in the clinic's timezone and no cron run exists for that clinic day (DST-safe, catches up later the same day). Missing Vault secrets log an `error` run `configuration_missing`, never raise. « Tâches planifiées » shows them all; « Exécuter maintenant » (`settings.manage`) runs one for the caller's clinic.

| Job | Kind | Schedule (UTC) | Does |
|---|---|---|---|
| `core.rate_limits_cleanup` | sql | `7 * * * *` | deletes windows older than 24 h |
| `core.webhook_events_purge` | sql | `10 8 * * *` | clears payloads (failed ones after 7 days), deletes events after 90 days |
| `core.scheduled_jobs_reconcile` | sql | `*/15 * * * *` | turns `pg_net` failures and silences into `error` runs (`http_<status>`, `timeout`, `network`, `no_response` after 1 h); closes `running` runs older than 15 min (`abandoned`); deletes reconciled dispatches older than 7 days |
| `core.scheduled_job_runs_purge` | sql | `20 8 * * *` | runs older than 90 days, `cron.job_run_details` older than 14 days |
| `core.email_log_retention` | sql | `30 8 * * *` | nulls `to_email` after 24 months (P3-6), batches of 5 000 |
| `core.email_log_stale_queued` | sql | `*/15 * * * *` | fails rows `queued` for over 15 min as `provider_unavailable` (outcome unknown) |
| `core.notifications_purge` | sql | `0 9 * * *` | notices older than 12 months, or expired more than 30 days ago |
| `core.secure_links_purge` | sql | `25 8 * * *` | links 12 months after their last event (use, revocation, expiry) |
| `core.invite_orphans_purge` | sql | `17 * * * *` | auth users created by `accept-invite` (`app_metadata.invite_link_id`, removed on acceptance) with no profile and no sign-in after 1 h; also the account kept after an ambiguous `accept_rpc` error |
| `core.storage_cleanup` | function `storage-cleanup` | `40 8 * * *` | purges files by the rules below, objects first (batches of 100), then rows `purged` |
| `core.signing_reconcile` | function `signing-sync` | `50 8 * * *` | syncs requests silent for over a day, expires overdue ones, settles stale drafts (4 at a time per org) |

**Cron times are in UTC**, whatever the clinic's timezone: `10 8 * * *` runs at 4:10 in Montréal in summer (EDT, UTC−4) and 3:10 in winter (EST, UTC−5). « Tâches planifiées » shows a daily time converted to the clinic's timezone (`scheduleLabel`). Only a `local_hour` job follows the clinic clock (P3-22).

**The two frequent jobs run every 15 minutes** (final Phase 3 review; every 5 before): `core.scheduled_jobs_reconcile` and `core.email_log_stale_queued` almost always find nothing, and every run writes a `scheduled_job_runs` row. At 15 minutes a stuck email or a failed dispatch shows at most 15 minutes later than it did, an unfinished run is closed 15 to 30 minutes after its start, and `no_response` still waits for 1 hour (pg_net keeps responses 6 hours). Skipping the row of an empty run was the other option; it was not taken because the run log is how « Tâches planifiées » shows that pg_cron is alive.

**Retiring a job:** never delete its row; in a new migration set `is_active = false` and `cron.unschedule('<cron_job_name>')` together.

### Email

- **Templates:** the effective template is the clinic's override (`email_templates`) or the catalogue default. Placeholders are `{{ path }}` from the template's declared `variables` (one rule shared with the renderer, `_shared/format.ts` `PLACEHOLDER_SOURCE`; SQL checks every save). « Réinitialiser » deletes the override; version numbers keep counting (`email_template_versions`), so an `email_log` row always names one text, whose content is in the audit trail.
- **Send path** (`_shared/email/send.ts` `sendTemplatedEmail`): `get_email_context` ∥ rate limits → render (layout from `_shared/email/`, wordmark at `APP_URL/email/wordmark.png`, P3-10) → `queue_email` (refuses a version or permission that changed meanwhile) → transport (`EMAIL_TRANSPORT`: `resend`, `mailpit` locally, or `console`), 3 attempts on 429/5xx (0.5 s then 2 s, P3-4) → `mark_email_sent` / `mark_email_failed`. Limits: 500 per org per day; 1 per address and template per minute for a normal send, or a 5 s double-click guard for « Renvoyer » and test sends; test sends 10 per hour per caller; free recipients 20 per user per hour (P3-18: `recipient_mode = 'free'` only; attachments only with `allows_attachments`, PDF, ≤ 3, ≤ 10 MB). Each message carries the `email_log_id` tag.
- **Statuses:** `queued < sent < delivery_delayed < delivered`; `bounced`, `complained` and `failed` are final, except `failed` / `provider_unavailable` (outcome unknown), which a later webhook may still move on (shown « Résultat inconnu », never « Échec »). Resend's own failure is `failed` / `provider_failed`. `resend-webhook` (Svix-signed, per org `?org=`) applies events through `apply_email_event`.
- **Retention:** `to_email` nulled after 24 months (P3-6, Christine to confirm); rows kept. No suppression list of our own (P3-5).
- Seeded: `core.staff_invite` (the staff invitation, `users.view`).

### Notifications

A notice reaches every holder of `recipient_permission` in its org, optionally narrowed to one user (who must still hold the permission); read state is per user (`notification_reads`), with no fan-out. The permission belongs to the notice's own module, so disabling the module empties the bell. Addressed by permission on purpose: a new holder sees past notices, a revoked one stops seeing them. `dedupe_key` (per org and kind) makes a repeated `notify` return the existing id. `link_path` is app-relative only (never an open redirect). The bell polls the count every 60 s while the tab is visible (P3-24); its list loads only when opened; Accueil « À surveiller » shows up to 5 important unread notices. Create one with `private.notify(…)` from a module RPC, or `notify(client, …)` (`_shared/notifications.ts`) from a function after `requireModuleForOrg`.

### Secure links and staff invitations (ADR 0007)

- **Links:** only the SHA-256 of a 32-byte random token is stored; the token travels in the URL **fragment** (`#t=`) and can be shown only when it is created (P3-7). One live link per (org, purpose, subject): issuing revokes the previous one. Consumption is one `update` (its row lock makes a second submit find no use left). `peek_secure_link` answers unknown and revoked alike (`invalid`); `expired` and `used` add only the purpose. Purposes are a catalogue whose rows name their handler RPCs (P3-16): `resolve_rpc(p_link_id) → jsonb` (what the page shows) and, for an account-creating purpose, `accept_rpc(p_token_hash, p_user_id, p_payload) → jsonb`, which consumes the link and does the module's work in one transaction. `020_core_secure_links` checks every seeded purpose against that contract.
- **Public functions:** `resolve-link` and `accept-invite` rate-limit by IP before any lookup, gate the module from the link row, and answer `link_invalid` / `link_expired` / `link_used` (410). `accept-invite` creates the auth user (`app_metadata.invite_link_id`), then calls `accept_rpc`; an existing account elsewhere answers the generic « Ce lien ne peut plus être utilisé… » (P3-8).
- **Actor model:** the inviter must never learn the token, or she could invite any address and accept it herself. So `create_staff_invitation` and `renew_staff_invitation` are **service-role RPCs with an explicit `p_actor`**: `staff-invite` verifies the caller (`users.manage`), generates and hashes the token in memory, passes `p_actor` = the verified user id (never from the body), and emails the link. The RPCs re-check everything as `p_actor` (active member with `users.manage`, the role guards of `set_user_role`: base or own custom role, no `provider`, only an admin invites an admin, never a role carrying a permission she lacks) after the org lock, and attribute the audit rows to her (`app.audit_actor`). Revoke and list stay user RPCs. Professionnels 4b uses the same model.
- **P3-31:** acceptance re-checks the **inviter's** standing (still active, still `users.manage`, still allowed that role); otherwise it answers `link_invalid`, writes nothing and leaves the invitation pending for an admin to revoke or re-send.
- **P3-32:** disabling a user deletes their `auth.sessions` in the same transaction (`set_user_status`); `users-set-status` also bans the account in Auth (P3-9) and reports `signin_blocked`.
- Only an address with a profile in **this** org is refused at invitation; nothing reads `auth.users` then. The account exists only once accepted (profile, role and accepted invitation in one transaction).

### Storage (design §7)

| Bucket | Limit | Types | Holds |
|---|---|---|---|
| `org-assets` | 2 MB | PNG, JPEG, WebP | the logo and the signature image |
| `documents` | 10 MB | PDF, PNG, JPEG, WebP, Word (`.doc` only for purposes that need it, `.docx`) | uploads and rendered PDFs to sign |
| `signed-documents` | 20 MB | PDF | signed PDFs |

- All three are **private**, and there is **no client policy on `storage.objects`** for them (P3-33): no client reads an object or signs a URL. Reads go through **`storage-sign`**, which selects the `stored_files` row with the caller's client (its RLS decides; unreadable → 404) and signs a **5-minute** URL with the service role (`download` sets the file name). Uploads: `storage-upload` (registers a `pending` row through `create_pending_upload`, returns a one-time signed upload token for the database-chosen path) → the browser `uploadToSignedUrl` → `storage-confirm` (sniffs the stored bytes against the declared type, size and image side; a refusal rejects the row before removing the object) → `ready`. Per-user limits: upload 60/h, confirm 120/h, sign 120/h.
- **Purposes** (`upload_purposes`) carry the bucket, permissions and caps (within the bucket's limits, trigger); a module purpose's permissions must belong to its module, and a module file always has a view permission (trigger), so disabling the module closes every path to its files. Core purposes: `org_logo` (upload `settings.manage`, view any member), `org_signature` (view `settings.manage`), both PNG/JPEG only, 2 MB, ≤ 4000 px, staged 1 day; `signing_source` and `signing_signed` (system files, `settings.integrations_manage`, staged 1 day).
- **Paths** never contain a name (Loi 25) and never move; a module trusts a file's subject only after its own RPC attached it (`private.attach_stored_file`, which also clears `retain_until`, P3-17). `original_name` refuses `/`, `\`, control and bidirectional characters.
- **Purge** (`storage-cleanup`): `pending` after 24 h, `deleted` after 30 days (24 h if never confirmed), `ready` past `retain_until`; objects removed in batches, then rows `purged` (kept). No listed file is ever revived. No antivirus (P3-14).

### Signing (design §6, ADR 0005, ADR 0008)

- **Templates** are versioned: `draft → published → archived` (or a draft discarded), at most one draft and one published per template; a published or archived version never changes (trigger), so a request's text is fixed. Bodies are the renderer's closed block model; publishing checks what the renderer needs (title, footer, one final signature page whose roles are exactly the signers).
- **Requests:** `draft` (between insert and Documenso's success) → `sent → viewed → signed | rejected | cancelled | expired`, monotonic, driven by Documenso events (`signing-webhook`, and `signing-sync` for a lost one); a terminal state never moves. `DOCUMENT_COMPLETED` stamps `completed_event_at` (from then on nothing can expire, reject or cancel it) and the request becomes `signed` only once the signed PDF is stored (`complete_signature_request`). One open request per record and purpose; the idempotency key always returns its own row.
- **The send claim:** one send at a time per request. `begin_signature_request_send` claims the draft under its row lock (a claim older than 10 min is a dead send); a concurrent send gets 409 « Un envoi est déjà en cours. ». A re-send first settles the earlier Documenso document (completed → recovered, pending/draft → cancelled; a failed cancel stops the re-send), and the new document supersedes it (`superseded_document_ids`, whose late webhooks are ignored).
- **Recovery:** a draft Documenso completed (a send that died before `mark_signature_request_sent`) is recovered by `recover_signature_request`, only for the request's **own** document: Documenso's `externalId` must be the request id (checked by the functions) and the document id the draft's recorded one (checked by the RPC). A source PDF no longer staged is recorded missing, never blocking. The reconcile job claims drafts too and settles them after an hour (with a document) or a day (without).
- **Address and key (P3-34):** `base_url` is `https://` to a public DNS name (or the local fake), checked again before every request (no redirects, private addresses refused); a new origin deletes the stored key. The functions read the address and the key together (`get_signing_credentials`, one statement), so a key is never paired with an address it was not typed for.
- **One instance's documents only:** Documenso ids are per instance, so a request is only ever matched by its own id, Documenso's `externalId`. `apply_signing_event` takes the request id (no lookup by document id alone); `signing-webhook` acks a document without one (made outside the app) as `ignored`; a sync checks the `externalId` (and that the request still records that document) before applying anything or downloading. `set_signing_settings` refuses (P0001) an origin change while a request is open at the current instance (a draft holding a document, sent, viewed). Webhook claim ids carry the org (`<org>:<event>:<document>`).
- Documenso sends the signing emails (P3-3); signer addresses are never readable by clients, logged or returned.

### Rate limits and webhook claims

- **Rate limits:** `consume_rate_limit(bucket, key_hash, max, window)` records one hit in a fixed window and answers `(allowed, hits, retry_after_seconds)`; concurrent hits serialise on the upsert's row lock, so exactly `max` pass. Keys are HMAC-hashed by `_shared/rate-limit.ts` (`LIMITS`, one window per bucket); a refused hit past `max + 1` writes nothing. Unavailable → fails closed (503). Both webhooks take one hit per IP (`webhooks.resend_ip`, `webhooks.documenso_ip`: 600 per minute) before they read the org's secret, since anyone can post to them; `email-preview` takes one per caller (300 per hour).
- **Webhook claims:** `claim_webhook_event` claims a delivery under a lease (new, failed, or lapsed) with a fresh token: `duplicate` (done) → 200, `in_progress` → 409 (the provider retries). Only the token holder completes (payload and error cleared) or fails it (payload kept for the retry, error as a code). The org comes from the URL (`?org=`) after the signature, never from the payload; an event id held by another org is refused.

### Edge functions

| Function | Category | Auth | Does |
|---|---|---|---|
| `email-preview` | user | `settings.view` | renders a template (saved or draft) |
| `email-test-send` | user | `settings.email_manage` | « M'envoyer un test » to the caller |
| `staff-invite` | user | `users.manage` | invite or « Renvoyer » (actor model) |
| `users-set-status` | user | `users.manage` | disable (sessions end, Auth ban) or enable |
| `storage-upload`, `storage-confirm`, `storage-sign` | user | the purpose's / the row's permissions (RLS) | uploads and 5-min read URLs |
| `signing-test-connection`, `signing-test-document` | user | `settings.integrations_manage` | Documenso check; built-in test document |
| `resolve-link`, `accept-invite` | public token | the token (`verify_jwt = false`), per-IP limits | link page data; account creation |
| `resend-webhook` | webhook | Svix signature, `?org=` | email statuses |
| `signing-webhook` | webhook | `X-Documenso-Secret` (`timingSafeEqual`), `?org=` | signing events, signed PDF |
| `storage-cleanup` | job | `X-Job-Signature` | `core.storage_cleanup` |
| `signing-sync` | user + job | caller's RLS, or `X-Job-Signature` | « Synchroniser »; `core.signing_reconcile` |

Only `signing-test-document` renders a PDF (pdfmake, about +0.8 MB uploaded); `_shared/pdf/isolation.test.ts` keeps the renderer out of every other function.

### How a module plugs in

All of it is data seeded by the module's own migration (core never imports module code, ADR 0003):
- **Email:** insert `email_template_defaults` rows (`<module>.<name>`, `variables`, `view_permission` of the module, `recipient_mode`, `allows_attachments`); send from a module function with `sendTemplatedEmail` (`_shared/email/send.ts`) after `requireModuleForOrg`, with the record as subject; read a record's history with `list_subject_emails`.
- **Notifications:** call `private.notify(…)` from a module RPC (or `notify` from a function), with a `<module>.<name>` kind, a module permission and a `dedupe_key`.
- **Links:** insert a `secure_link_purposes` row naming the module's `resolve_rpc` (and `accept_rpc`); issue with `private.issue_secure_link` from a definer RPC, the token generated and hashed by the function (`_shared/links.ts`).
- **Uploads:** insert `upload_purposes` (module permissions, caps, `retain_days` for anything a module RPC must attach); attach with `private.attach_stored_file` from the module RPC; list files through the module's own tables.
- **Jobs:** insert a `scheduled_jobs` row (`kind = 'function'`, `local_hour` for a clinic-hour job) and `cron.schedule` it; the function uses `runJob`.
- **Signing:** create document templates (module `view_permission` / `edit_permission`); call `createSignatureRequest` (`_shared/signing.ts`) from a module function with an idempotency key; read with `list_subject_signature_requests`.

## Frontend

- `src/core/auth/`: session, recovery, login/forgot/reset pages (ADR 0006).
- `src/core/access/`: `AccessProvider`, `useAccess`, `useReadyAccess`, guards `RequireAuth` / `RequireAccess`; `org-roles.ts` (`useOrgId`, `useOrgRoles`, `useRoleLabel`, `roleKeys`).
- `src/core/account/`: « Mon compte » (`/mon-compte`, every signed-in user): display name, email change (neutral, #38), password (with reauthentication code), « Se déconnecter de tous les appareils » (#33).
- `src/core/settings/`: `SettingsLayout`, `coreSettingsSections` (`sections.ts`), `paths.ts`, `visible-sections.ts`; `organization/`, `tax/`, `bank/` (api, hooks, Zod schemas); `components/` (`OrganizationCard`, `OrganizationSettingsPage`, `TaxRatesCard`, `NewTaxRateDialog`, `BankDetailsCard`/`Form`, `TimezonePicker`); `pages/` (one per section).
- `src/core/users/`: users list and sheet (`UserSheet`: role, status, one switch per permission), role matrix (`RoleMatrix`, `RoleNameDialog`, `DeleteRoleDialog`), `permissions.ts` (mirrors the database guards so the UI hides what the server would refuse).
- `src/core/audit/`: journal api/hooks, `labels.ts` (French field names and values), `period.ts`.
- Phase 3:
  - `src/core/supabase/functions.ts`: `invokeFunction(name, body, { signal })` and `FunctionCallError` (`code`, `status`, `field`, `extra`, `retryAfter`), `refusalMessage` (the French text of a 400 the function flagged `refusal: true`, else null); every edge-function call goes through it;
  - `src/core/email/`: « Courriels » (sender, keys, templates with preview and test, send log), `status.ts` (`emailStatusLabel`);
  - `src/core/jobs/`: « Tâches planifiées » (`jobKeys`, labels, schedule text);
  - `src/core/notifications/`: the bell's count (polled), list and « À surveiller » (`notificationKeys`); `src/app/shell/NotificationBell.tsx`, `src/app/HomeImportantNotices.tsx`;
  - `src/core/storage/`: `uploadFile`, `signedFileUrl`, `useSignedFileUrl` (5-min URLs, refreshed at 240 s), purposes' client-side caps; `src/shared/components/FileDropzone.tsx`, `src/shared/lib/files.ts`;
  - `src/core/signing/`: « Signature électronique » (address, keys, expiry, templates, test tools), `status.ts` (`signatureStatusLabel`);
  - `src/core/invitations/`: the public `/invitation` page (token in the fragment, `resolve-link` then `accept-invite`);
  - `src/core/auth/pages/ConfirmPage.tsx`: `/connexion/confirmer` (auth email links verified on click, ADR 0006 amendment);
  - `src/core/users/components/InviteDialog.tsx`, `PendingInvitationRows.tsx` (« Inviter », pending invitations, « Renvoyer » / « Révoquer »);
  - `src/core/settings/components/SecretField.tsx` (write-only secret with « Configuré le … »), `WebhookAddressField.tsx`, `OrgAssetCard.tsx` (logo and signature image).

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
| Tâches planifiées | `/parametres/taches-planifiees` | `settings.view` | `settings.manage` |
| Courriels | `/parametres/courriels` | `settings.view` | `settings.email_manage` (sender, templates) or `settings.integrations_manage` (keys, sending domain): each card follows its own |
| Signature électronique | `/parametres/signature-electronique` | `settings.view` | `settings.integrations_manage` |

« Paramètres » appears only when at least one section is visible (decision #19). With the defaults, the adjointe sees the clinic sections read-only and the conseillère and the professionnel see no Paramètres. Identité légale also holds the logo card and Signataire the signature image (`settings.manage` to change; the signature image is shown only with `settings.manage`).

**Public pages** (no session, code-split, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` in `vercel.json`): `/connexion/confirmer` and `/invitation`.
