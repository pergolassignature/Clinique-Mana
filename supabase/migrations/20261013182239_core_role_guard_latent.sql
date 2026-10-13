-- =============================================================================
-- Core: assigning a role no longer depends on which modules are switched on
-- =============================================================================
-- Asked:     coordinator, 2026-10-13 (CM-1, SM-11: the guard « fails closed »)
-- Decisions: CC-15 (decisions log)
--
-- A non-admin holding users.manage (the adjointe) may give a role only if she holds every
-- permission of its defaults. That rule read her *effective* permissions, which leave out a
-- disabled module's (or a module reserved for testers she is not one of): a role whose defaults
-- carried such a permission could not be given at all, so the modules kept their non-admin
-- defaults off (CM-1, SM-11).
--
-- The rule now reads what she holds by her role and her own overrides, **whatever the modules'
-- state** (`private.permission_keys_latent_for`): the same permissions she would hold once the
-- module is on. Why no one gains anything through a module switched on later: the person given
-- the role then gets only the role's defaults, every one of which the giver holds by the same
-- rule (her role's defaults or her own override), so switching the module on gives the giver
-- the same permissions at the same time. An explicit refusal on the giver (an override
-- `granted = false`) still refuses, and a module reserved for testers changes nothing either
-- way. Granting one permission (`set_role_permission`, the overrides) still reads the effective
-- permissions (unchanged).
--
-- Applied to `set_user_role`, `create_role` (the copy) and the staff invitations
-- (`staff_inviter` now returns the latent keys; `assert_can_invite_to_role` is unchanged).
-- Then Communications' plan defaults come back (A C J): `communications.inbox` and
-- `communications.sms` for Conseillère and Adjointe (template rows, propagated to every clinic;
-- in effect only once Communications is open to them).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_role_guard_latent', true);

-- What a user holds by her role and her overrides, every module counted (on or off, reserved or
-- not). An inactive or role-less user holds nothing.
create function private.permission_keys_latent_for(p_user uuid)
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
  )
  select coalesce(array_agg(pm.key order by pm.key), '{}')
    from public.permissions pm
   cross join me
    left join public.user_permission_overrides o
      on o.user_id = me.user_id
     and o.permission_key = pm.key
   where coalesce(
           o.granted,
           exists (select 1
                     from public.org_role_permissions rp
                    where rp.org_id = me.org_id
                      and rp.role = me.role
                      and rp.permission_key = pm.key))
$$;
revoke all on function private.permission_keys_latent_for(uuid) from public, anon, authenticated, service_role;

-- Same signature, grants and body as *_core_editable_roles.sql, but the hold check reads the
-- latent permissions.
create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text := private.assert_can_manage_user(p_user_id);
  v_org uuid := private.current_user_org_id();
  v_keys text[];
begin
  -- Serializes with the role RPCs: the role cannot be deleted, nor its defaults changed,
  -- between the checks below and the write.
  perform 1 from public.organizations o where o.id = v_org for no key update;

  -- A role deleted meanwhile (or another org's): « Ce rôle n'existe plus. », like the role RPCs.
  perform private.assert_org_role(v_org, p_role);
  if p_role = 'provider' or v_current = 'provider' then
    raise exception 'Le rôle Professionnel se gère dans le module Professionnels.' using errcode = 'P0001';
  end if;
  if p_role = 'admin' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut modifier un administrateur.' using errcode = 'P0001';
  end if;
  -- What the giver holds by her role and overrides, every module counted (CC-15).
  if not private.has_role('admin') then
    v_keys := private.permission_keys_latent_for(auth.uid());
    if exists (
      select 1 from public.org_role_permissions rp
       where rp.org_id = v_org and rp.role = p_role and not (rp.permission_key = any (v_keys))
    ) then
      raise exception 'Vous ne pouvez pas attribuer un rôle qui donne des permissions que vous n''avez pas.' using errcode = 'P0001';
    end if;
  end if;

  -- Becoming admin deletes the user's overrides (trigger user_roles_clear_admin_overrides).
  insert into public.user_roles (user_id, org_id, role)
  values (p_user_id, v_org, p_role)
  on conflict (user_id) do update set role = excluded.role
   where public.user_roles.role is distinct from excluded.role;
end;
$$;

-- Same signature, grants and body as *_core_editable_roles.sql, but the copy's hold check reads
-- the latent permissions.
create or replace function public.create_role(p_name text, p_copy_from text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.assert_can_manage_roles();
  v_name text := private.valid_role_name(v_org, p_name, null);
  v_key text;
  v_try int := 0;
  v_keys text[];
begin
  if p_copy_from is not null then
    perform private.assert_org_role(v_org, p_copy_from);
    if not private.has_role('admin') then
      v_keys := private.permission_keys_latent_for(auth.uid());
      if exists (
        select 1 from public.org_role_permissions rp
         where rp.org_id = v_org and rp.role = p_copy_from
           and not (rp.permission_key = any (v_keys))
      ) then
        raise exception 'Vous ne pouvez pas copier un rôle qui donne des permissions que vous n''avez pas.'
          using errcode = 'P0001', hint = 'copy_from';
      end if;
    end if;
  end if;

  -- 2^32 keys: a collision is unlikely; retry a few times rather than fail on one.
  loop
    v_key := 'custom_' || pg_catalog.encode(extensions.gen_random_bytes(4), 'hex');
    exit when not exists (select 1 from public.roles ro where ro.key = v_key);
    v_try := v_try + 1;
    if v_try >= 5 then
      raise exception 'Impossible de générer une clé de rôle unique' using errcode = 'XX000';
    end if;
  end loop;

  insert into public.roles (key, name, is_system, org_id) values (v_key, v_name, false, v_org);
  if p_copy_from is not null then
    insert into public.org_role_permissions (org_id, role, permission_key)
    select v_org, v_key, rp.permission_key
      from public.org_role_permissions rp
     where rp.org_id = v_org and rp.role = p_copy_from;
  end if;
  return v_key;
end;
$$;

-- Same signature, grants and checks as *_core_staff_invitations.sql: users.manage is checked on
-- the effective permissions; the keys returned (for assert_can_invite_to_role's hold rule) are
-- the latent ones (CC-15).
create or replace function private.staff_inviter(p_actor uuid, out org_id uuid, out role text, out keys text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not ('users.manage' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : users.manage' using errcode = '42501';
  end if;
  keys := private.permission_keys_latent_for(p_actor);
  -- Holding users.manage implies an active profile with a role.
  select p.org_id, r.role into org_id, role
    from public.profiles p
    join public.user_roles r on r.user_id = p.user_id
   where p.user_id = p_actor and p.status = 'active';
end;
$$;

-- Communications' plan defaults (A C J), now that a disabled module no longer blocks the role RPCs.
insert into public.role_permissions (role, permission_key) values
  ('counselor',       'communications.inbox'),
  ('admin_assistant', 'communications.inbox'),
  ('counselor',       'communications.sms'),
  ('admin_assistant', 'communications.sms')
on conflict do nothing;

select pg_catalog.set_config('app.audit_source', '', true);
