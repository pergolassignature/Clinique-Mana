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
- `roles` is audited since custom roles exist (`…_core_editable_roles.sql`): admins create, rename and delete them through RPCs. `org_id` comes from the row and is null for the shared base roles. `org_role_permissions` (each clinic's role defaults) is audited like any org-scoped table.

## 8. Secrets and sensitive data

- API keys and tokens live in **Vault**, referenced by `org_secrets`. Clients write with `set_org_secret`, list names with `list_org_secret_keys`, and never read values. Edge functions read with `get_org_secret(org_id, key)` under the service role. Deleting an `org_secrets` row (directly or by cascade from its organization) removes the Vault entry through a trigger.
- Sensitive non-secret data (SIN, bank details) goes in `*_private` tables, read through audited RPCs only, with the sensitive columns redacted from the audit trigger.

**Encrypted columns** (reference: `organization_bank_details`, migration `…_core_bank_details.sql`):
- Store the value in a `bytea` column, on a table with no client privilege (RLS on, no policy), revoked from `service_role` too: `revoke all on public.<table> from anon, authenticated, service_role;`.
- Encrypt with `private.encrypt_pii(text)` inside a SECURITY DEFINER RPC (owned by `postgres`) that checks its permission first. Key: Vault secret `pii_encryption_key`; AES-256 with a SHA-256 key derivation, via pgcrypto.
- Keep a `*_last4` (or otherwise masked) column for display; the « get » RPC returns only that.
- A reveal RPC decrypts with `private.decrypt_pii(bytea)` and writes an `audit_log` row: action `read`, `source = 'rpc:<function>'`, `changed_fields = {"fields": ["<column>", …]}` (the names of the revealed columns, never values). No stored value → return null, no audit row.
- Attach the audit trigger with the encrypted column **and every other value of the guarded data** redacted (masked column, related numbers, contact): `private.audit_trigger('<column>', …)`. `audit.view` must never show what the reveal permission guards; changes stay visible as `"[redacted]"`.
- `private.pii_key`, `encrypt_pii` and `decrypt_pii` are SECURITY INVOKER and granted to no role (`service_role` included): never grant them, never log or select the key.
- Only pass bytes read from an encrypted column to `decrypt_pii`, never caller-supplied bytes.

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
- `throws_ok` on a function the role cannot EXECUTE segfaults Postgres image `.106`: use `function_privs_are`.
- The local Postgres image (supabase/postgres 17.6.1.x) has segfaulted on pgTAP tests that define `pg_temp` plpgsql helpers with exception handlers. Don't define helper functions in tests; inline the logic or check function source via `pg_proc` instead.
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
| Every table with an `org_id` column has an `audit_trigger`, except `audit_log` and the operational logs `webhook_events`, `email_log`, `scheduled_job_runs`, `scheduled_job_dispatches`, `notifications`, `notification_reads` (they hold addresses and payloads that must not be copied into `audit_log` forever, §7) | attach it (§7) |
| Every view is `security_invoker = true` | §5b |
| `admin` holds every permission in every org (`org_role_permissions`) | add the `('admin', '<permission>')` row to `role_permissions` in the migration that adds the permission (§9) |

If a legitimate design needs an exception, change the invariant query explicitly (with a comment saying why) in the same PR; never disable the test.
