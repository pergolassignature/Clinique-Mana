-- =============================================================================
-- Append-only audit log
-- =============================================================================
-- One generic log for every business table, written by private.audit_trigger()
-- (ported from PS Hub fn_production_audit_trigger). Replaces legacy's per-table
-- audit tables.
--
-- Design:   docs/plans/2026-10-06-foundation-rebuild-design.md §4.4
-- Review:   docs/audit/2026-10-07-core-schema-design-review.md (I2, I3)
-- Rules:    docs/standards/database-conventions.md ("Audit")
--
-- Key choices
-- * Immutable for everyone, the owner included: BEFORE UPDATE/DELETE/TRUNCATE
--   triggers raise 42501 unless `app.audit_purge = 'on'` (reserved for a future
--   retention job run by the owner). Clients and service_role also lack the
--   privileges.
-- * org_id and actor_id carry no foreign keys: the log must outlive the rows
--   and users it describes, and an FK action could never update an immutable row.
-- * Columns named in the trigger arguments are redacted (Loi 25):
--     execute function private.audit_trigger('sin', 'bank_account')
-- =============================================================================

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  -- insert/delete: the row; update: {column: {before, after}} for changed columns.
  changed_fields jsonb,
  actor_id uuid,
  actor_role text,
  -- `app.audit_source` when set (seed, RPC name, job…), else derived from the API role.
  source text not null default coalesce(
    nullif(pg_catalog.current_setting('app.audit_source', true), ''),
    case auth.role()
      when 'authenticated' then 'app'
      when 'service_role' then 'service'
      else 'system'
    end
  ),
  created_at timestamptz not null default now()
);

create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
create index audit_log_actor_created_idx on public.audit_log (actor_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Privileges and RLS
-- -----------------------------------------------------------------------------
revoke all on public.audit_log from anon, authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;
grant select on public.audit_log to authenticated;
-- service_role may append (edge functions logging reads of private data) but
-- never rewrite history.
revoke update, delete, truncate on public.audit_log from service_role;

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('audit.view'))
  );

-- -----------------------------------------------------------------------------
-- Immutability
-- -----------------------------------------------------------------------------
create function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('app.audit_purge', true), '') <> 'on' then
    raise exception 'audit_log is append-only' using errcode = '42501';
  end if;
  -- Purge mode: let the row operation proceed (returning null would skip it).
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

-- -----------------------------------------------------------------------------
-- Generic row trigger
-- -----------------------------------------------------------------------------
-- Trigger arguments (TG_ARGV) = columns to redact.
-- org_id comes from the row's `org_id` column (`id` for organizations), so every
-- audited table must carry org_id (see conventions).
create function private.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then pg_catalog.to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then pg_catalog.to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed jsonb;
  v_org uuid;
  v_record_id text;
  v_actor uuid := auth.uid();
  v_actor_role text;
  i int;
begin
  -- What changed ----------------------------------------------------------------
  if tg_op = 'UPDATE' then
    select pg_catalog.jsonb_object_agg(n.key, pg_catalog.jsonb_build_object('before', o.value, 'after', n.value))
      into v_changed
      from pg_catalog.jsonb_each(v_new) n
      join pg_catalog.jsonb_each(v_old) o using (key)
     where n.value is distinct from o.value
       and n.key <> 'updated_at';
    if v_changed is null then
      return null;  -- nothing but updated_at changed (AFTER trigger: return value ignored)
    end if;
  else
    v_changed := v_row;
  end if;

  -- Redaction (I3) ---------------------------------------------------------------
  for i in 0 .. tg_nargs - 1 loop
    if v_changed ? tg_argv[i] then
      v_changed := pg_catalog.jsonb_set(v_changed, array[tg_argv[i]], '"[redacted]"'::jsonb);
    end if;
  end loop;

  -- Org --------------------------------------------------------------------------
  if tg_table_schema = 'public' and tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  elsif v_row ? 'org_id' then
    v_org := (v_row ->> 'org_id')::uuid;
  end if;

  -- Record id: primary-key columns in index order, joined with ':' --------------
  select pg_catalog.string_agg(v_row ->> a.attname, ':' order by k.ord)
    into v_record_id
    from pg_catalog.pg_index ix
    cross join lateral pg_catalog.unnest(ix.indkey::int2[]) with ordinality as k(attnum, ord)
    join pg_catalog.pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.attnum
   where ix.indrelid = tg_relid
     and ix.indisprimary;

  -- Actor (role read regardless of status: a disabled actor is still named) -----
  if v_actor is not null then
    select r.role into v_actor_role from public.user_roles r where r.user_id = v_actor;
  end if;

  -- `source` is left to the column default.
  insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, actor_role)
  values (
    v_org,
    tg_table_name,
    coalesce(v_record_id, 'n/a'),
    pg_catalog.lower(tg_op),
    v_changed,
    v_actor,
    v_actor_role
  );

  return null;
end;
$$;

revoke all on function private.audit_trigger(), private.audit_log_immutable()
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Attach to the core tables
-- -----------------------------------------------------------------------------
-- Catalogues (modules, permissions, role_permissions, roles) change only through
-- migrations, which are their history.
create trigger organizations_audit
  after insert or update or delete on public.organizations
  for each row execute function private.audit_trigger();
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function private.audit_trigger();
create trigger user_roles_audit
  after insert or update or delete on public.user_roles
  for each row execute function private.audit_trigger();
create trigger user_permission_overrides_audit
  after insert or update or delete on public.user_permission_overrides
  for each row execute function private.audit_trigger();
create trigger org_modules_audit
  after insert or update or delete on public.org_modules
  for each row execute function private.audit_trigger();
