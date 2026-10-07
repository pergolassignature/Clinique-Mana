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
- Prefer RPCs for writes that touch several rows or need checks; grant `insert`/`delete` only when a plain RLS policy fully describes the rule.
- `service_role` keeps Supabase's defaults (it bypasses RLS and is server-only). Revoke from it explicitly when a table must be protected from server code too (`audit_log`).

## 4. Table shape

| Rule | Example |
|---|---|
| `org_id uuid not null` on every business table, including per-user child tables | `user_roles.org_id` |
| Per-user tables use a composite FK so org_id cannot drift | `foreign key (user_id, org_id) references public.profiles(user_id, org_id) on delete cascade` |
| `created_at` / `updated_at timestamptz not null default now()` + the shared trigger | `for each row execute function private.set_updated_at()` |
| Actor columns point at **profiles**, never at `auth.users` | `updated_by uuid references public.profiles(user_id) on delete set null` |
| Only `public.profiles` references `auth.users` | — |
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
| `private.has_permission(text)` | role defaults ∪ override grants − override revokes; `false` when disabled or role-less |

Canonical shape:

```sql
create policy trainings_select on public.trainings
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('trainings.view'))
  );
```

- **Never query `profiles` or `user_roles` inline in a policy** (legacy hit RLS recursion twice). Add a helper instead.
- Write `with check` for every `update`/`insert` policy; it usually repeats the org condition.
- Edge functions cannot call `private.*`. They use `get_my_access()` (permissions) and `module_enabled()` (module gate).

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
- Serialize read-check-write sequences that span rows with a lock (`perform 1 from public.organizations where id = v_org for update;`).

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
- `record_id` is the PK columns joined with `:` (`<org_id>:<module_key>`). `updated_at`-only updates are skipped.
- `source` defaults to `app.audit_source` if set, else `app` (authenticated), `service` (service role) or `system`. RPCs that log explicitly use `rpc:<function_name>`; seeds set `seed`.
- Changes invisible to the row diff (e.g. a Vault value) get an explicit row from the RPC — see `set_org_secret`. Reads of `*_private` data are logged by their RPCs.
- Catalogue tables changed only by migrations (`modules`, `permissions`, `role_permissions`, `roles`) are not audited: git is their history.

## 8. Secrets and sensitive data

- API keys and tokens live in **Vault**, referenced by `org_secrets`. Clients write with `set_org_secret`, list names with `list_org_secret_keys`, and never read values. Edge functions read with `get_org_secret(org_id, key)` under the service role.
- Sensitive non-secret data (SIN, bank details) goes in `*_private` tables, read through audited RPCs only, with the sensitive columns redacted from the audit trigger.

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
  ('admin', 'trainings.view'), ('admin', 'trainings.manage'), ('staff', 'trainings.view')
on conflict do nothing;
```

Then, for each table: shape (§4) → `revoke all` + grants (§3) → RLS policies (§5) → `set_updated_at` and audit triggers (§7) → FK indexes. A new module starts **disabled** in every org; enable it with `set_module_enabled` (or in `seed.sql` locally). List the module's tables in `docs/modules/<module>.md`. Other modules read them only through a view or RPC the owner publishes.

## 10. Tests (pgTAP)

One file per migration in `supabase/tests/database/NNN_<name>.test.sql`, written **before** the migration. Each file runs in `begin; … rollback;` and creates its own fixtures (orgs A and B, one user per role).

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
- A table the role has no privilege on raises `42501`; it does not return 0 rows. RLS-filtered tables return 0 rows.
- OrbStack may lack macOS access to `~/Documents`, so `supabase test db` finds no files. Grant OrbStack the Documents folder, or mirror the tests elsewhere and pass the path: `supabase test db /tmp/pgtap`.

Run `supabase db reset && supabase test db` (the full suite) after every migration.

## 11. Seeds

`supabase/seed.sql` is **local only** (remote resets always use `--no-seed`). It starts with `select set_config('app.audit_source', 'seed', false);`, refuses to run if real users exist, inserts `org_id` on per-user tables and enables the modules under development. Test users share one documented password.
