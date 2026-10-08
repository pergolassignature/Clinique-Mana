# Database conventions

**For:** anyone adding a table, RPC or module to the Clinique MANA database.
**Sources:** [core schema design review](../audit/2026-10-07-core-schema-design-review.md), plan amendment A1, design §2–§4. The core migrations (`supabase/migrations/20261007140517_core_access.sql` → `…140859_professionals_module.sql`) are the reference implementation: copy their patterns.

---

## 1. Migrations

- File name `YYYYMMDDHHMMSS_<english_name>.sql` from `date -u +%Y%m%d%H%M%S`. Seconds must not be `00` (`npm run lint:migrations`).
- Header comment: purpose, design reference, key choices. Sections separated by `-- ----` banners.
- Additive within a release. Destructive changes need an ADR and two steps (deprecate, then remove).
- Seed rows in migrations (modules, permissions, role defaults) end with `on conflict do nothing`.
- Never apply to staging by hand or through the MCP: `supabase db reset && supabase test db` locally, then the normal push.

## 2. Identifiers are English, labels are French

Tables, columns, module keys, permission keys and function names are English. User-facing strings stored as data (`modules.name`, `roles.name`, permission descriptions, error messages raised to the UI) are French.

```sql
insert into public.modules (key, name) values ('professionals', 'Professionnels');
raise exception 'Permission refusée : modules.manage' using errcode = '42501';
```

## 3. Closed by default

The first migration revokes Supabase's default grants, so every new table, sequence and function in `public` starts **closed** for `anon` and `authenticated`, and new functions anywhere are not executable by `PUBLIC`. Each table still states its privileges explicitly:

```sql
revoke all on public.trainings from anon, authenticated;
grant select on public.trainings to authenticated;
grant update (title, starts_on) on public.trainings to authenticated;   -- column-level, never table-level UPDATE
```

- Clients never get `TRUNCATE`, `REFERENCES` or `TRIGGER` (TRUNCATE bypasses RLS).
- Clients never get `INSERT` or `DELETE` either: inserts and deletes go through RPCs (enforced by `000_invariants`). Updates use column grants plus an RLS policy, or an RPC when they need checks.
- `service_role` keeps Supabase's defaults (it bypasses RLS and is server-only). Revoke from it explicitly when a table must be protected from server code too (`audit_log`; writes on `org_role_permissions`, whose admin rows guard against lock-out).

## 4. Table shape

| Rule | Example |
|---|---|
| `org_id uuid not null` on every business table, including per-user child tables | `user_roles.org_id` |
| Per-user tables use a composite FK so org_id cannot drift | `foreign key (user_id, org_id) references public.profiles(user_id, org_id) on delete cascade` |
| `created_at` / `updated_at timestamptz not null default now()` + the shared trigger | `for each row execute function private.set_updated_at()` |
| Actor columns point at **profiles**, never at `auth.users` | `updated_by uuid references public.profiles(user_id) on delete set null` |
| Only `public.profiles` references `auth.users` | — |
| `auth.users` is the only source of `profiles.email` (a trigger copies it on insert/update and on auth email change) | — |
| Index every FK column that is not a prefix of the PK | `create index trainings_updated_by_idx on public.trainings (updated_by);` |
| Reference data is soft-deleted (`is_active`), never hard-deleted | — |
| Enumerations that may grow are lookup tables with text keys, not Postgres enums | `roles(key)`, `user_roles.role references roles(key)` |
| JSON settings are objects | `check (jsonb_typeof(settings) = 'object')` |

## 5. RLS policies and the private helpers

Enable RLS on every table. Policies call the helpers in schema `private` (not exposed through the API), always wrapped in `(select …)` so they run once per statement:

| Helper | Returns |
|---|---|
| `private.current_user_org_id()` | caller's org, or `null` if no active profile |
| `private.current_user_role()` | role key (text), or `null` if inactive / no role |
| `private.has_role(text)` | boolean |
| `private.current_permission_keys()` | the caller's effective permission keys (`text[]`, sorted): the org's role defaults ∪ override grants − override revokes, **only for modules enabled in the caller's org** (`core` always is); `'{}'` when disabled or role-less. The one place permissions are evaluated |
| `private.has_permission(text)` | `key = any (current_permission_keys())`; `false` for a null or unknown key |

Canonical shape:

```sql
create policy trainings_select on public.trainings
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('trainings.view'))
  );
```

- When the permission key comes from the row (`view_permission`, `owner_permission`), test it against the array, once per statement. The cast is required: without it `= any ((select …))` is the subquery form and fails with « operator does not exist: text = text[] ».

```sql
using (
  org_id = (select private.current_user_org_id())
  and view_permission = any ((select private.current_permission_keys())::text[])
)
```

- Use the array form for every row-level permission column: `stored_files.view_permission` / `owner_permission`, `email_log.view_permission`, `notifications.recipient_permission`, `document_templates.view_permission`, `signature_requests.view_permission`. A row whose permission belongs to a disabled module then disappears on its own (the key leaves the array), so the column must hold a permission **of the row's module** (enforce it: a composite FK to `permissions (key, module_key)`, or a trigger such as `stored_files_check_module_gate`). Never call `private.has_permission(<column>)` per row: it cannot be hoisted out of the scan.
- **Every module policy includes a `has_permission` term.** It is the module gate: when an org disables a module, `has_permission('<module>.*')` turns false and the module's rows disappear. An ownership-only policy (`user_id = (select auth.uid())`) skips the gate, so combine it: `… and (select private.has_permission('trainings.view'))`.
- **Never query `profiles` or `user_roles` inline in a policy** (legacy hit RLS recursion twice). Add a helper instead.
- Write `with check` for every `update` policy; it usually repeats the org condition. (Clients have no `insert` privilege, so there are no client insert policies.)
- Edge functions cannot call `private.*`. They use `get_my_access()` (permissions and enabled modules, already filtered) and `module_enabled()`. A function that works with the **service role** bypasses RLS and therefore the gate: a user-scoped function still calls `requireModule()` (or `verifyAuth(req, { module })`); a function without a user (webhook, cron) resolves the org from a database row and calls `requireModuleForOrg()`, which uses `module_enabled_for_org(org_id, key)` (service role only).

## 5b. Views

Cross-module reads go through views published by the owning module (design §6.2). A plain view runs as its **owner**, which bypasses RLS and leaks across orgs. Views are always `security_invoker = true` (enforced by `000_invariants`), and like tables they start with no client grants:

```sql
create view public.professionals_directory with (security_invoker = true) as
  select p.id, p.org_id, p.display_name from public.professionals p where p.is_active;
revoke all on public.professionals_directory from anon, authenticated;
grant select on public.professionals_directory to authenticated;
```

## 6. Functions

- `set search_path = ''` and **fully-qualified names** for everything outside `pg_catalog` (`public.profiles`, `auth.uid()`, `vault.create_secret`).
- `security definer` only when the function must read or write past RLS; check the permission **first**, then act:

```sql
create function public.archive_training(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('trainings.manage') then
    raise exception 'Permission refusée : trainings.manage' using errcode = '42501';
  end if;
  update public.trainings t set is_active = false
   where t.id = p_id and t.org_id = private.current_user_org_id();
end $$;
revoke all on function public.archive_training(uuid) from public, anon, authenticated;
grant execute on function public.archive_training(uuid) to authenticated;
```

- Always scope definer queries to `private.current_user_org_id()`; a definer function ignores RLS.
- Helpers and trigger functions go in `private`; only RPCs the frontend or edge functions call go in `public` (test 003 asserts the exact list with `functions_are`).
- Trigger functions: `revoke all … from public, anon, authenticated, service_role` (firing a trigger does not need EXECUTE).
- Error codes: `42501` permission, `22023` invalid argument, `P0001` business rule. Messages in French.
- **User-facing messages use `P0001` only.** A message the user should read is raised with `raise exception '…' using errcode = 'P0001'`, written in French, and names things by their label (module names, not keys). The frontend shows a `P0001` message as is, maps `42501` to its own « permission » text and `23514` (check violation, only reachable by bypassing the client's validation or through a Zod/SQL parity bug) to a « valeur invalide » text that is also reported to Sentry, and replaces every other code (`22023`, timeouts, deadlocks, PostgREST/JWT errors, network failures) with a generic message reported to Sentry (allow-list in `src/core/modules/errors.ts`). So `22023` messages such as « Module inconnu » are for developers, not users.
- Serialize read-check-write sequences that span rows with a lock on the org row: `perform 1 from public.organizations o where o.id = v_org for no key update;`. Use `for no key update`, not `for update`: it serializes writers just as well but does not block the FK key-share checks that every insert referencing `organizations` takes. The pattern relies on READ COMMITTED (the PostgREST default): after the lock, the next statement sees what the other writer committed. Lock a single target row the same way (`assert_can_manage_user` locks the target profile). When a function takes both, **lock the target profile first, then the org row**, like every core function and the last-admin trigger ([core module doc, « Locks »](../modules/core.md#locks)); the other order can deadlock.

## 7. Audit

`public.audit_log` is append-only for every role: triggers raise `42501` on UPDATE/DELETE/TRUNCATE unless the owner sets `app.audit_purge = 'on'` (reserved for a future retention job). Clients read it with `audit.view`, scoped to their org.

- Attach `private.audit_trigger()` to **every business table**. Its arguments are the columns to redact:

```sql
create trigger trainings_audit
  after insert or update or delete on public.trainings
  for each row execute function private.audit_trigger();

create trigger professional_private_audit            -- Loi 25: no PII or ciphertext in the log
  after insert or update or delete on public.professional_private
  for each row execute function private.audit_trigger('sin', 'bank_account');
```

- The trigger records `org_id` from the row (`id` for `organizations`), so audited tables need `org_id`.
- Redaction covers `changed_fields`, **not `record_id`**: a primary-key column must never be a redacted value (no SIN or email as a key).
- `record_id` is the PK columns joined with `:` (`<org_id>:<module_key>`). `updated_at`-only updates are skipped.
- `source` defaults to `app.audit_source` if set, else `app` (authenticated), `service` (service role) or `system`. RPCs that log explicitly use `rpc:<function_name>`; seeds set `seed`.
- Changes invisible to the row diff (e.g. a Vault value) get an explicit row from the RPC — see `set_org_secret`. Reads of `*_private` data are logged by their RPCs.
- Catalogue tables changed only by migrations (`modules`, `permissions`, `role_permissions`) are not audited: git is their history.
- **Operational logs are not audited either**, even with an `org_id`: `webhook_events`, `email_log`, `scheduled_job_runs`, `scheduled_job_dispatches`, `notifications`, `notification_reads` (and `rate_limits`, which has no `org_id`). They are written by the service role or by RPCs, hold recipient addresses or provider payloads, and are purged; auditing them would copy that data into the append-only `audit_log` forever (Loi 25; Phase 3 design §2.5). The list lives in `000_invariants` (§12): a new operational log is added there with its reason, never by disabling the check.
- Operational logs keep no free text that could hold personal data: `detail` / `error` columns hold counts or codes (SQLSTATE, never `sqlerrm`), payloads hold ids only, and each log has a retention job (`scheduled_jobs`, maintenance). Read paths are RLS-filtered like any table.
- **`signature_request_syncs` is not audited** (`…_core_signing_capture.sql`): the signing reconcile's per-request state (times and codes), rewritten every hour for every open request; auditing it would add an audit row per request per hour forever. Rows are deleted once the request closes (`core.signing_unsaved_alert`). Same exception list. It has no `created_at` / `updated_at` (§4): `attempted_at` is its write time, stamped by `record_signature_sync` on every attempt, and it has no `set_updated_at` trigger.
- **`user_preferences` is not audited** (`…_core_user_preferences.sql`): it is UI state (remembered list filters), private to its user and rewritten on every filter change, and the search text it keeps may name a client, which `audit_log` would then keep forever (Loi 25). It is in the same `000_invariants` exception list (§12).
- `roles` is audited since custom roles exist (`…_core_editable_roles.sql`): admins create, rename and delete them through RPCs. `org_id` comes from the row and is null for the shared base roles. `org_role_permissions` (each clinic's role defaults) is audited like any org-scoped table.

## 8. Secrets and sensitive data

- API keys and tokens live in **Vault**, referenced by `org_secrets`. Clients write with `set_org_secret`, list names with `list_org_secret_keys`, and never read values. Edge functions read with `get_org_secret(org_id, key)` under the service role. Deleting an `org_secrets` row (directly or by cascade from its organization) removes the Vault entry through a trigger.
- Sensitive non-secret data (SIN, bank details) goes in `*_private` tables, read through audited RPCs only, with the sensitive columns redacted from the audit trigger.

**Encrypted columns** (reference: `organization_bank_details`, migration `…_core_bank_details.sql`):
- Store the value in a `bytea` column, on a table with no client privilege (RLS on, no policy), revoked from `service_role` too: `revoke all on public.<table> from anon, authenticated, service_role;`.
- Add `key_version smallint not null default 1` with `check (key_version >= 1)`: one version for all the row's encrypted columns.
- **One version per row (the write rule).** Every write leaves the whole row on the current version `v := private.pii_current_key_version()`, in **one** statement: each encrypted column the call sets is `private.encrypt_pii(value, v)`; each encrypted column it keeps is re-encrypted, `private.encrypt_pii(private.decrypt_pii(<column>, <row>.key_version), v)`; and `key_version = v`. A row already on `v` keeps its kept ciphertexts as they are (`case when key_version = v then <column> else … end`, so the audit log does not show a change that did not happen). Never store a new ciphertext next to an old-version one under a single `key_version`. Reference: `set_bank_details`. **4a.17's RPCs (`set_professional_private`, `clear_professional_private_field`) follow it:** a call that sets the account but keeps the SIN re-encrypts the SIN in the same `update`.
- Do the write inside a SECURITY DEFINER RPC (owned by `postgres`) that checks its permission first. AES-256 with a SHA-256 key derivation, via pgcrypto.
- Keep a `*_last4` (or otherwise masked) column for display; the « get » RPC returns only that.
- A reveal RPC decrypts with `private.decrypt_pii(<column>, <row>.key_version)` and writes an `audit_log` row: action `read`, `source = 'rpc:<function>'`, `changed_fields = {"fields": ["<column>", …]}` (the names of the revealed columns, never values). No stored value → return null, no audit row.
- Attach the audit trigger with the encrypted column **and every other value of the guarded data** redacted (masked column, related numbers, contact): `private.audit_trigger('<column>', …)`. `audit.view` must never show what the reveal permission guards; changes stay visible as `"[redacted]"`.
- `private.pii_key`, `encrypt_pii`, `decrypt_pii`, `pii_encrypted_values`, `pii_key_versions_in_use`, `pii_current_key_version` and `pii_seed_canary` are SECURITY INVOKER and granted to no role (`service_role` included): never grant them, never log or select the key.
- Only pass bytes read from an encrypted column to `decrypt_pii`, with that row's `key_version`, never caller-supplied bytes.
- **Add every encrypted column to `private.pii_encrypted_values()`** (`create or replace`, one `union all` branch per column: table name, column name, `key_version`, ciphertext, nulls left out) in the migration that creates it. It is the one list the health check, `pii_key_versions_in_use()`, `pii_seed_canary()` and the rotation runbook read: a column missing from it is invisible to the health check, and a key could be retired while it still holds data. pgTAP checks the new branch.
- List the table and its encrypted columns in [`pii-key-rotation.md`](../runbooks/pii-key-rotation.md) (table and the re-encryption block of step 4), in the same change.

**Key versions** (migration `…_core_pii_key_versions.sql`, ADR 0004 « Before Phase 4 »):
- Version 1 is the Vault secret `pii_encryption_key`; version n ≥ 2 is `pii_encryption_key_v<n>`. `private.pii_key(v)` returns null for a missing version, and `encrypt_pii` / `decrypt_pii` then raise `55000`. The version arguments are `integer` (a `smallint` column casts to it implicitly, while an integer literal such as `2` would not resolve to a `smallint` parameter).
- The one-argument forms (`pii_key()`, `encrypt_pii(text)`, `decrypt_pii(bytea)`) mean version 1. They stay for compatibility only: new code always passes a version, or it breaks once version 1 is retired.
- **Canary:** `private.pii_canary` holds the fixed test value `'mana-pii-canary'` encrypted with each live version (no grant, RLS on, no policy). The highest version with a canary is the write version (`private.pii_current_key_version()`), so adding a key's canary is what switches writes to it. A canary is only ever created by `private.pii_seed_canary(v)`, which refuses (false, with a warning) when the version already has one, its key is missing, or any value stored with `v` does not decrypt with the current `v` key.
- **Versions in use:** `private.pii_key_versions_in_use()` lists, per table, the versions that hold at least one ciphertext (from `pii_encrypted_values()`). A row whose encrypted columns are all null needs no key and does not count.
- **Health check:** `public.pii_health_check()` (definer, granted to no role: `postgres`, its owner, runs it) returns true when every canary decrypts **and** every version in use has its key and a canary, false otherwise; it never raises for a key problem and never returns a key or a value. GitHub runs it after each migration push (« Apply Supabase migrations », even when the push failed) and every day (`pii-health.yml`), through `scripts/pii-health-check.sh`: a result other than `t` turns the job red. It is an alarm, not a gate: nothing waits for it, and Vercel deploys the app regardless.
- **Runbooks:** [`pii-key-escrow.md`](../runbooks/pii-key-escrow.md) (owner's copy of each version, restore before loading data, what to do when the check fails) and [`pii-key-rotation.md`](../runbooks/pii-key-rotation.md). Never insert a canary by hand to make the check pass: only `pii_seed_canary`, as those runbooks say.

## 8b. Catalogues and definer handlers (the shared-services pattern)

Core services (Phase 3) are extended by **data**, never by core importing module code (ADR 0003). The pattern, used by `scheduled_jobs`, `email_template_defaults`, `upload_purposes` and `secure_link_purposes`:

- **A global catalogue table, seeded by the owning module's migration** (`insert … on conflict do nothing`), not audited (git is its history, like `permissions`). Its key is `<module>.<name>` and a check pins the prefix to `module_key` (link purposes have no dot: `staff_invite`). A row is never deleted: retire it with `is_active = false` (jobs also `cron.unschedule` in the same migration).
- **Every permission a row names belongs to the row's module** (composite FK to `permissions (key, module_key)`, `private.permission_in_module`, or a check trigger such as `check_upload_purpose`), so disabling the module closes everything the row opens. Core rows may name any permission.
- **Limits live in one place:** a catalogue row stays within its parent's limits (a trigger checks `upload_purposes` against `storage.buckets`); SQL twins of TypeScript maps (`private.mime_extension` ↔ `FORMATS`) are compared by a Deno test that reads the migration.
- **Handlers are named, not coded:** a row may name a function that core calls (`secure_link_purposes.resolve_rpc` / `accept_rpc`, called by name from `resolve-link` / `accept-invite`; `scheduled_jobs.sql_function` (`private.job_*`) or `function_name`). Names are checked by a regex in the table (`^[a-z][a-z0-9_]{2,62}$`, `^private\.job_[a-z0-9_]+$`), and a pgTAP test checks every seeded row against the handler contract: `public.<name>` with the exact arguments and return type, not overloaded, **`security definer`**, EXECUTE for `service_role` only (`020_core_secure_links`, which runs before any fixture so it sees only migration rows; `search_path` is checked by `000_invariants`). A handler does the module's whole work in one transaction (e.g. `accept_rpc` consumes the link with `private.consume_secure_link` and creates the account), and scopes every query to the org it is given.
- **Module RPCs reach core state only through `private` helpers** granted to no role (`notify`, `issue_secure_link`, `consume_secure_link`, `revoke_secure_links`, `attach_stored_file`, `soft_delete_stored_file`): they are `security invoker`, so they work only inside the module's own `security definer` RPC, after its permission check. Edge functions use the service-role RPCs instead (`create_notification`, `register_system_file`, …).
- **Per-org state for a catalogue row** is an ordinary audited org table: `org_scheduled_jobs` (a row for every org × job, created by triggers on both parents), `email_templates` (a clinic's override, created when it saves one).
- **Service-role RPCs that act for a user take the actor explicitly** (`create_staff_invitation(p_actor, …)`): the function passes the user it verified (never an id from the body), the RPC re-checks the actor's permissions with `private.permission_keys_for(p_actor)` and sets `app.audit_actor` (and `app.audit_source = 'rpc:<name>'`) so the audit rows name that person. Use it whenever a secret (a token) must be generated server-side and never reach the caller.

## 9. Adding a module (recipe)

One migration `…_<module>_module.sql` registers it; later migrations add its tables.

```sql
insert into public.modules (key, name) values ('trainings', 'Formations') on conflict do nothing;
insert into public.module_dependencies (module_key, depends_on) values ('trainings', 'professionals')
  on conflict do nothing;                                        -- only if it really depends on it
insert into public.permissions (key, module_key, description) values
  ('trainings.view',   'trainings', 'Voir les formations'),
  ('trainings.manage', 'trainings', 'Gérer les formations')
on conflict do nothing;                                          -- key prefix must equal module_key
insert into public.role_permissions (role, permission_key) values
  ('admin', 'trainings.view'), ('admin', 'trainings.manage'), ('counselor', 'trainings.view')
on conflict do nothing;
```

- Module keys never equal a core permission prefix (`settings`, `users`, `modules`, `audit`, `roles`): a check constraint refuses them.
- Dependencies never mention `core` (it is implicit) and must stay acyclic: a trigger rejects any edge that closes a cycle (`23514`).
- A disabled module grants nothing: its permissions vanish from `has_permission` and `get_my_access` until an admin enables it.

- Grant **every** new module permission to `admin`: admins hold every permission (overrides on admins are refused, so nothing else can give them one; `000_invariants` checks it in every org). A new `role_permissions` row is the template: a trigger copies it into every existing org's `org_role_permissions`.

Then, for each table: shape (§4) → `revoke all` + grants (§3) → RLS policies (§5) → `set_updated_at` and audit triggers (§7) → FK indexes. A new module starts **disabled** in every org; enable it with `set_module_enabled` (or in `seed.sql` locally). List the module's tables in `docs/modules/<module>.md`. Other modules read them only through a view or RPC the owner publishes.

## 10. Tests (pgTAP)

One file per migration in `supabase/tests/database/NNN_<name>.test.sql`, written **before** the migration. `000_invariants.test.sql` checks the whole catalog (§12) and needs no change when you add a module: it just has to stay green. Each file runs in `begin; … rollback;` and creates its own fixtures (orgs A and B, one user per role).

```sql
-- Privileges: exact lists, for every table
select table_privs_are('public', 'trainings', 'anon', array[]::text[], 'anon: nothing');
select table_privs_are('public', 'trainings', 'authenticated', array['SELECT'], 'authenticated: select only');
select column_privs_are('public', 'trainings', 'title', 'authenticated', array['SELECT', 'UPDATE'], 'title is updatable');
-- Function denials: privileges, NOT throws_ok
select function_privs_are('public', 'archive_training', array['uuid'], 'anon', array[]::text[], 'anon cannot call');
-- Acting as a user
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
-- Service role
reset role; set local role service_role;
```

Cover at least: privileges for `anon` and `authenticated`; cross-org isolation (org B sees nothing of org A); each role's allowed and refused actions; disabled users; the audit row of a write (and redaction where configured).

Traps:
- **Never call a function as a role that lacks EXECUTE on it** (`set local role authenticated; select public.<service_role-only RPC>(…)`), whether through `throws_ok`, `lives_ok`, a plain `select` or a policy: the local Postgres image (supabase/postgres 17.6.1.106) crashes the backend instead of raising `42501`, and the whole test file fails. Assert denials with `function_privs_are` (and `table_privs_are` for tables); call service RPCs after `reset role; set local role service_role;`.
- **No `pg_temp` helpers.** The same image has segfaulted on pgTAP tests that define `pg_temp` plpgsql helpers with exception handlers. Don't define helper functions in tests; inline the logic in plain SQL assertions, or check function source via `pg_proc` instead.
- A table the role has no privilege on raises `42501`; it does not return 0 rows. RLS-filtered tables return 0 rows.
- OrbStack may lack macOS access to `~/Documents`, so `supabase test db` finds no files. Grant OrbStack the Documents folder, or mirror the tests elsewhere and pass the path: `supabase test db /tmp/pgtap`.
- The local seed writes rows (including audit rows): filter assertions by fixture ids, never count a whole table.

Run the full suite after every migration, with and without the seed: `supabase db reset && supabase test db`, then `supabase db reset --no-seed && supabase test db`.

## 11. Seeds

`supabase/seed.sql` is **local only** (remote resets always use `--no-seed`). It starts with `select set_config('app.audit_source', 'seed', false);`, refuses to run if real users exist, inserts `org_id` on per-user tables and enables the modules under development. Test users share one documented password.

## 12. Catalog invariants (`000_invariants.test.sql`)

These hold for every current and future object; a violation fails CI.

| Invariant | Fix when it fails |
|---|---|
| Every `public` table has RLS enabled | `alter table … enable row level security` |
| Policies call `private.*` / `auth.*` only inside `(select …)` | wrap the call (§5) |
| No client `INSERT`, `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER` on `public` tables | writes go through RPCs; updates are column grants (§3) |
| `anon` has no table privilege in `public` | `revoke all … from anon` |
| No `public` / `private` function is executable by `anon` or `PUBLIC` | `revoke all on function … from public, anon` |
| Every function in `public` / `private` has `set search_path = ''` | add it, qualify names (§6) |
| Every foreign key has an index whose first column is the FK's first column | add the index (§4) |
| Every table with an `org_id` column has an `audit_trigger`, except `audit_log` and the operational logs `webhook_events`, `email_log`, `scheduled_job_runs`, `scheduled_job_dispatches`, `notifications`, `notification_reads` (they hold addresses and payloads that must not be copied into `audit_log` forever, §7), `user_preferences` (UI state whose search text may name a client, §7) and `signature_request_syncs` (the signing reconcile's hourly state, §7) | attach it (§7) |
| Every view is `security_invoker = true` | §5b |
| `admin` holds every permission in every org (`org_role_permissions`) | add the `('admin', '<permission>')` row to `role_permissions` in the migration that adds the permission (§9) |

If a legitimate design needs an exception, change the invariant query explicitly (with a comment saying why) in the same PR; never disable the test.
