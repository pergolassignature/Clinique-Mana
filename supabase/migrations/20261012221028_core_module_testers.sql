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
-- module is still in testing (P3-40: such sends are refused or held then). Dependencies stay
-- consistent: a module is reserved only if no open, enabled module depends on it, opened only if
-- none of its dependencies is reserved, and enabled open only if none of them is reserved.
-- private.send_sms (Communications' one choke point for texts) holds every text to a client while
-- Communications is reserved.
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
  v_blockers text[];
begin
  if not private.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;
  if p_testers_only is null then
    raise exception 'p_testers_only est requis' using errcode = '22023';
  end if;
  perform 1 from public.organizations o where o.id = v_org for no key update;
  perform private.ensure_org_module(v_org, p_key);
  if p_testers_only then
    -- An open, enabled module that needs this one would keep its permissions for non-testers.
    select array_agg(m.name order by m.name) into v_blockers
      from public.module_dependencies d
      join public.org_modules om on om.org_id = v_org and om.module_key = d.module_key and om.enabled and not om.testers_only
      join public.modules m on m.key = d.module_key
     where d.depends_on = p_key;
    if v_blockers is not null then
      raise exception 'Réservez d''abord aux testeurs : %', pg_catalog.array_to_string(v_blockers, ', ') using errcode = 'P0001';
    end if;
  else
    -- Opened while a module it needs stays reserved: non-testers would use it without that one.
    select array_agg(m.name order by m.name) into v_blockers
      from public.module_dependencies d
      join public.org_modules om on om.org_id = v_org and om.module_key = d.depends_on and om.testers_only
      join public.modules m on m.key = d.depends_on
     where d.module_key = p_key;
    if v_blockers is not null then
      raise exception 'Ouvrez d''abord à tous : %', pg_catalog.array_to_string(v_blockers, ', ') using errcode = 'P0001';
    end if;
  end if;
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

-- -----------------------------------------------------------------------------
-- set_module_enabled: an open module is not enabled on a reserved dependency
-- -----------------------------------------------------------------------------
-- Same signature, grants and body as *_core_user_admin.sql, plus one check when enabling: a module
-- that is not reserved itself needs every dependency open to all (else non-testers would use it
-- without what it needs). Reserving it first, or opening the dependency, lifts the refusal.
create or replace function public.set_module_enabled(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_blockers text[];
begin
  if not private.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;

  -- Serialize toggles per org so two concurrent calls cannot break a dependency (I10).
  perform 1 from public.organizations o where o.id = v_org for no key update;

  if not exists (select 1 from public.modules m where m.key = p_key) then
    raise exception 'Module inconnu : %', p_key using errcode = '22023';
  end if;
  if p_key = 'core' then
    raise exception 'Le module core est toujours actif' using errcode = '22023';
  end if;

  if p_enabled then
    -- Every dependency must already be enabled (core is implicit, never listed).
    -- The message is user-facing (P0001), so it lists module names, not keys.
    select array_agg(m.name order by m.name)
      into v_blockers
      from public.module_dependencies d
      join public.modules m on m.key = d.depends_on
     where d.module_key = p_key
       and not exists (
         select 1 from public.org_modules om
          where om.org_id = v_org and om.module_key = d.depends_on and om.enabled);
    if v_blockers is not null then
      raise exception 'Activez d''abord : %', array_to_string(v_blockers, ', ') using errcode = 'P0001';
    end if;
    -- R-72: an open module never rests on a dependency reserved for testers.
    if not exists (select 1 from public.org_modules om where om.org_id = v_org and om.module_key = p_key and om.testers_only) then
      select array_agg(m.name order by m.name)
        into v_blockers
        from public.module_dependencies d
        join public.org_modules om on om.org_id = v_org and om.module_key = d.depends_on and om.testers_only
        join public.modules m on m.key = d.depends_on
       where d.module_key = p_key;
      if v_blockers is not null then
        raise exception 'Réservez d''abord ce module aux testeurs, comme : %', array_to_string(v_blockers, ', ') using errcode = 'P0001';
      end if;
    end if;
  else
    -- No enabled module may depend on this one (names, as above).
    select array_agg(m.name order by m.name)
      into v_blockers
      from public.module_dependencies d
      join public.org_modules om
        on om.org_id = v_org and om.module_key = d.module_key and om.enabled
      join public.modules m on m.key = d.module_key
     where d.depends_on = p_key;
    if v_blockers is not null then
      raise exception 'Désactivez d''abord : %', array_to_string(v_blockers, ', ') using errcode = 'P0001';
    end if;
  end if;

  insert into public.org_modules (org_id, module_key, enabled, updated_at, updated_by)
  values (v_org, p_key, p_enabled, now(), auth.uid())
  on conflict (org_id, module_key) do update
    set enabled = excluded.enabled,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
end;
$$;

-- -----------------------------------------------------------------------------
-- private.send_sms: no text to a client while Communications is reserved (P3-40)
-- -----------------------------------------------------------------------------
-- Same signature, grants and body as *_communications_sms.sql, plus the first check: while the
-- module is reserved for testers, a text a person types (reply, other) is refused in French, and
-- an automatic one (consent notice, reminder, confirmation, change) is not queued at all (null:
-- every automatic caller uses `perform`), so nothing piles up to leave at the go-live. The test
-- and the « ARRÊT » acknowledgement still go.
create or replace function private.send_sms(
  p_org uuid,
  p_to text,
  p_body text,
  p_kind text,
  p_subject_type text default null,
  p_subject_id uuid default null,
  p_at_once boolean default false,
  p_actor uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_to text := private.sms_normalize_e164(p_to);
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_consent text;
  v_id uuid;
begin
  if p_kind not in ('opt_out_ack', 'test') and not public.module_open_to_all_for_org(p_org, 'communications') then
    if p_kind in ('reply', 'other') then
      raise exception 'Les textos aux clients sont suspendus : le module Communications est réservé aux testeurs.'
        using errcode = 'P0001', hint = 'module_reserved';
    end if;
    return null;
  end if;
  if v_to is null then
    raise exception 'Le numéro de téléphone n''est pas valide : indiquez un numéro à 10 chiffres.' using errcode = 'P0001';
  end if;
  if v_body = '' or pg_catalog.length(v_body) > 1600 then
    raise exception 'Le texto doit compter de 1 à 1600 caractères.' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('reply', 'reminder', 'confirmation', 'changed', 'consent_notice', 'opt_out_ack', 'test', 'other') then
    raise exception 'Invalid kind' using errcode = '22023';
  end if;
  if p_kind not in ('opt_out_ack', 'test') then
    v_consent := private.sms_consent_status(p_org, v_to);
    if v_consent is distinct from 'opted_in' then
      raise exception 'Aucun texto ne peut être envoyé à ce numéro : la personne n''a pas donné son consentement, ou l''a retiré.'
        using errcode = 'P0001', hint = coalesce(v_consent, 'no_consent');
    end if;
  end if;
  insert into public.sms_messages (org_id, direction, peer_e164, kind, body, status, subject_type, subject_id, send_after, sent_by)
  values (p_org, 'out', v_to, p_kind, v_body, 'queued', p_subject_type, p_subject_id,
          case when p_at_once then null else private.sms_business_send_after(p_org, pg_catalog.now()) end,
          p_actor)
  returning id into v_id;
  return v_id;
end;
$$;
