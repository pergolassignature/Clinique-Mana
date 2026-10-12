-- =============================================================================
-- Core: a module reserved for named testers (R-72)
-- =============================================================================
-- Decisions: R-72 (testing in production with named testers), P3-39, P3-40 (decisions log)
-- Docs:      docs/modules/core.md « Modules reserved for testers »
--
-- The clinic tests the new modules in production, on dry-run-imported data, before the go-live.
-- A module that is enabled AND `testers_only` grants its permissions only to the users listed
-- in `org_module_testers` (an admin too: Jonathan lists himself); everyone else gets nothing of
-- it, exactly as if it were off (permissions, menus, routes, settings, RLS). `testers_only`
-- defaults to false: nothing changes on deploy, and a module without the flag behaves as before.
-- Disabling a module keeps its flag and its testers (switching it on again keeps the same test).
--
-- The one place permissions are evaluated, private.permission_keys_for, gains one term per
-- module row: `not om.testers_only or exists (tester row)`, a primary-key lookup evaluated only
-- for a testers-only module. get_my_access (the UI's modules) and module_enabled (the caller's
-- view) follow; module_enabled_for_org (jobs, webhooks: no user) stays org-level, and
-- module_open_to_all_for_org tells a function sending to people outside the clinic that the
-- module is still in testing (core.md: such sends are refused then, unless a job or a setting
-- enables them explicitly).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_module_testers', true);

-- -----------------------------------------------------------------------------
-- The flag and the testers
-- -----------------------------------------------------------------------------
alter table public.org_modules add column testers_only boolean not null default false;

create table public.org_module_testers (
  org_id uuid not null,
  module_key text not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint org_module_testers_pkey primary key (org_id, module_key, user_id),
  constraint org_module_testers_module_fkey foreign key (org_id, module_key)
    references public.org_modules (org_id, module_key) on delete cascade,
  constraint org_module_testers_user_fkey foreign key (user_id, org_id)
    references public.profiles (user_id, org_id) on delete cascade
);
create index org_module_testers_user_idx on public.org_module_testers (user_id, org_id);
create index org_module_testers_created_by_idx on public.org_module_testers (created_by);

revoke all on public.org_module_testers from anon, authenticated;
grant select on public.org_module_testers to authenticated;
alter table public.org_module_testers enable row level security;
create policy org_module_testers_select on public.org_module_testers
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('modules.manage')));
create trigger org_module_testers_audit after insert or update or delete on public.org_module_testers
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Whether a module is open to a user: enabled, and not reserved or the user is a tester
-- -----------------------------------------------------------------------------
-- Same signature, result, grants (create or replace keeps them) and body as
-- *_core_staff_invitations.sql, plus the testers term in `perm`.
create or replace function private.permission_keys_for(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select r.user_id, r.role, p.org_id
      from public.user_roles r
      join public.profiles p on p.user_id = r.user_id
     where r.user_id = p_user
       and p.status = 'active'
  ),
  -- The permissions whose module is open to the user: core, or enabled for her org and, when
  -- reserved for testers, she is one of them (R-72).
  perm as (
    select pm.key
      from public.permissions pm
     cross join me
     where pm.module_key = 'core'
        or exists (
             select 1 from public.org_modules om
              where om.org_id = me.org_id
                and om.module_key = pm.module_key
                and om.enabled
                and (not om.testers_only
                     or exists (select 1 from public.org_module_testers t
                                 where t.org_id = om.org_id
                                   and t.module_key = om.module_key
                                   and t.user_id = me.user_id)))
  )
  select coalesce(array_agg(perm.key order by perm.key), '{}')
    from perm
   cross join me
    left join public.user_permission_overrides o
      on o.user_id = me.user_id
     and o.permission_key = perm.key
   where coalesce(
           o.granted,
           exists (select 1
                     from public.org_role_permissions rp
                    where rp.org_id = me.org_id
                      and rp.role = me.role
                      and rp.permission_key = perm.key))
$$;

-- The modules the caller sees (her org's enabled modules, those reserved for testers only if she
-- is one). Same body as *_professionals_submission_review_reads.sql otherwise.
create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id',      p.user_id,
    'org_id',       p.org_id,
    'org_name',     o.name,
    'org_timezone', o.timezone,
    'display_name', p.display_name,
    'email',        p.email,
    'status',       p.status,
    'role',         r.role,
    'permissions',  to_jsonb(private.current_permission_keys()),
    'modules', case when p.status = 'active' then coalesce((
        select jsonb_agg(om.module_key order by om.module_key)
          from public.org_modules om
         where om.org_id = p.org_id
           and om.enabled
           and (not om.testers_only
                or exists (select 1 from public.org_module_testers t
                            where t.org_id = om.org_id and t.module_key = om.module_key and t.user_id = p.user_id))
      ), '[]'::jsonb) else '[]'::jsonb end,
    'has_professional_file', private.current_professional_id() is not null
  )
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  left join public.user_roles r on r.user_id = p.user_id
  where p.user_id = auth.uid()
$$;

-- For the caller (the app, user functions): enabled, and open to her.
create or replace function public.module_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_key = 'core' or exists (
    select 1
      from public.org_modules om
     where om.org_id = private.current_user_org_id()
       and om.module_key = p_key
       and om.enabled
       and (not om.testers_only
            or exists (select 1 from public.org_module_testers t
                        where t.org_id = om.org_id and t.module_key = om.module_key and t.user_id = auth.uid()))
  )
$$;

-- For functions that reach people outside the clinic (a text or an email to a client): true when
-- the module is enabled for the org and no longer reserved for testers. Service role only, like
-- module_enabled_for_org; the org comes from the verified user or a database row.
create function public.module_open_to_all_for_org(p_org_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_key = 'core' or exists (
    select 1
      from public.org_modules om
     where om.org_id = p_org_id
       and om.module_key = p_key
       and om.enabled
       and not om.testers_only
  )
$$;
revoke all on function public.module_open_to_all_for_org(uuid, text) from public, anon, authenticated;
grant execute on function public.module_open_to_all_for_org(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- RPCs (modules.manage, as « Modules »)
-- -----------------------------------------------------------------------------
-- The flag and the testers of every module of the caller's org (the settings page).
create function public.list_module_testers()
returns table (module_key text, testers_only boolean, tester_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;
  return query
    select om.module_key, om.testers_only,
           coalesce((select array_agg(t.user_id order by t.created_at, t.user_id)
                       from public.org_module_testers t
                      where t.org_id = om.org_id and t.module_key = om.module_key), '{}')
      from public.org_modules om
     where om.org_id = private.current_user_org_id()
     order by om.module_key;
end;
$$;

-- The module's row of the caller's org, created (disabled) when the module was never toggled.
create function private.ensure_org_module(p_org uuid, p_key text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key = 'core' or not exists (select 1 from public.modules m where m.key = p_key) then
    raise exception 'Module inconnu : %', p_key using errcode = '22023';
  end if;
  insert into public.org_modules (org_id, module_key, enabled, updated_at, updated_by)
  values (p_org, p_key, false, now(), auth.uid())
  on conflict (org_id, module_key) do nothing;
end;
$$;
revoke all on function private.ensure_org_module(uuid, text) from public, anon, authenticated, service_role;

-- Reserves a module for its testers (true) or opens it to everyone (false).
create function public.set_module_testers_only(p_key text, p_testers_only boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;
  if p_testers_only is null then
    raise exception 'p_testers_only est requis' using errcode = '22023';
  end if;
  perform 1 from public.organizations o where o.id = v_org for no key update;
  perform private.ensure_org_module(v_org, p_key);
  update public.org_modules om
     set testers_only = p_testers_only, updated_at = now(), updated_by = auth.uid()
   where om.org_id = v_org and om.module_key = p_key and om.testers_only is distinct from p_testers_only;
end;
$$;

-- Adds a tester: an active member of the clinic.
create function public.add_module_tester(p_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;
  perform 1 from public.organizations o where o.id = v_org for no key update;
  perform private.ensure_org_module(v_org, p_key);
  if not exists (select 1 from public.profiles p where p.user_id = p_user_id and p.org_id = v_org and p.status = 'active') then
    raise exception 'Cette personne n''est pas un utilisateur actif de la clinique.' using errcode = 'P0001', hint = 'user_id';
  end if;
  insert into public.org_module_testers (org_id, module_key, user_id, created_by)
  values (v_org, p_key, p_user_id, auth.uid())
  on conflict do nothing;
end;
$$;

-- Removes a tester (nothing when she is not one).
create function public.remove_module_tester(p_key text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;
  delete from public.org_module_testers t
   where t.org_id = private.current_user_org_id() and t.module_key = p_key and t.user_id = p_user_id;
end;
$$;

revoke all on function public.list_module_testers(), public.set_module_testers_only(text, boolean),
                       public.add_module_tester(text, uuid), public.remove_module_tester(text, uuid)
  from public, anon, authenticated;
grant execute on function public.list_module_testers(), public.set_module_testers_only(text, boolean),
                          public.add_module_tester(text, uuid), public.remove_module_tester(text, uuid)
  to authenticated;
