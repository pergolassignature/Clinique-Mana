-- =============================================================================
-- Staff access follow-ups: sessions ended on disable, orphan invite users purged, invitation expiry
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.20b (P3-32)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * P3-32: `set_user_status(…, 'disabled')` also deletes the user's `auth.sessions` rows in the
--   same transaction. Their refresh tokens (`auth.refresh_tokens.session_id`) and MFA claims go
--   with them (ON DELETE CASCADE), so a refresh token taken from a compromised device does not
--   come back to life when the account is re-enabled. The Auth ban set by `users-set-status`
--   stays: it blocks new sign-ins. An access token already issued lives until it expires, but a
--   disabled profile holds no permission (`current_permission_keys` reads `status = 'active'`).
--   supabase-js `auth.admin.signOut` takes the user's JWT, not an id, hence SQL.
--   Redefined here with `create or replace` (same signature, grants, guards and messages as
--   *_core_user_admin.sql, a Phase 2 file left unchanged), plus the delete. It runs on every
--   'disabled' call, also when the profile already was disabled, so a repeated « Désactiver »
--   ends any session left. The function owner (postgres, the migration role) may delete from
--   `auth.sessions`: checked locally; hosted is checked at Mise en service (16d).
-- * Orphan invite users: accept-invite creates the auth user (with `app_metadata.invite_link_id`)
--   and then calls `accept_staff_invitation`. If the function is killed in between, or its
--   compensating delete fails, the auth user stays without a profile, and the invitee can never
--   accept again (createUser answers `email_exists`). The maintenance SQL job
--   `core.invite_orphans_purge` (hourly, minute 17) deletes the `auth.users` rows that carry the
--   marker, have no `public.profiles` row and are more than 1 hour old. Their identities,
--   sessions and other `auth` children cascade. Same owner check as above.
-- * `create_staff_invitation` returns `(id, expires_at)` like `renew_staff_invitation`, so
--   `staff-invite` sends the email without a second read. The return type changes, so the
--   function is dropped and created again with the same body and grants (service_role only).
--   Nothing else depends on it.
-- * `list_staff_invitations` also returns `last_email_error_code` (the last email's
--   `email_log.error_code`), so « Utilisateurs et accès » shows « Résultat inconnu » rather than
--   « Échec » for `failed` + `provider_unavailable`. A new result column: dropped and created
--   again, same body otherwise and same grants (authenticated only).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_staff_access_followups', true);

-- -----------------------------------------------------------------------------
-- set_user_status: disabling ends the user's sessions (P3-32)
-- -----------------------------------------------------------------------------
create or replace function public.set_user_status(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage_user(p_user_id);
  if p_status is null or p_status not in ('active', 'disabled') then
    raise exception 'Statut inconnu : %', p_status using errcode = '22023';
  end if;
  if p_status = 'active' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut réactiver un compte.' using errcode = 'P0001';
  end if;
  update public.profiles p set status = p_status
   where p.user_id = p_user_id and p.status is distinct from p_status;
  if p_status = 'disabled' then
    -- Refresh tokens and MFA claims cascade from their session.
    delete from auth.sessions s where s.user_id = p_user_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Job: core.invite_orphans_purge (private.run_sql_job)
-- -----------------------------------------------------------------------------
-- Deletes the auth users an interrupted acceptance left behind (header). A handful of rows at
-- most: one statement over auth.users.
create function private.job_invite_orphans_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from auth.users u
   where u.raw_app_meta_data ? 'invite_link_id'
     and u.created_at < pg_catalog.now() - interval '1 hour'
     and not exists (select 1 from public.profiles p where p.user_id = u.id);
  get diagnostics v_deleted = row_count;
  return 'deleted=' || v_deleted;
end;
$$;

revoke all on function private.job_invite_orphans_purge() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('core.invite_orphans_purge', 'core', 'Purge des comptes d''invitation inachevés',
   'Supprime, après une heure, les comptes créés par une acceptation d''invitation qui n''a pas abouti, pour que la personne puisse accepter de nouveau.',
   'sql', 'private.job_invite_orphans_purge', 'core.invite_orphans_purge', true)
on conflict do nothing;

select cron.schedule('core.invite_orphans_purge', '17 * * * *',
  $$select private.run_sql_job('core.invite_orphans_purge')$$);

-- -----------------------------------------------------------------------------
-- create_staff_invitation returns (id, expires_at)
-- -----------------------------------------------------------------------------
-- Same body as *_core_staff_invitations.sql except the return; see its header for the contract
-- with staff-invite, the guards, the locks and the audit attribution.
drop function public.create_staff_invitation(uuid, text, text, text, bytea);

create function public.create_staff_invitation(
  p_actor uuid, p_email text, p_display_name text, p_role text, p_token_hash bytea)
returns table (id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_actor record;
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email, E' \t\r\n'));
  v_name text := pg_catalog.btrim(p_display_name, E' \t\r\n');
  v_id uuid := gen_random_uuid();
  v_link uuid;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  -- The actor's org unlocked, the org lock, then her permissions and guards: a change committed
  -- while this waited for the lock is seen (lock before checks, like the role RPCs).
  select p.org_id into v_org from public.profiles p where p.user_id = p_actor;
  perform 1 from public.organizations o where o.id = v_org for no key update;
  select * into v_actor from private.staff_inviter(p_actor);
  if v_actor.org_id is distinct from v_org then
    raise exception 'Permission refusée : users.manage' using errcode = '42501';
  end if;

  if v_email is null or pg_catalog.length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse courriel invalide.' using errcode = 'P0001';
  end if;
  if coalesce(pg_catalog.length(v_name), 0) not between 1 and 80 then
    raise exception 'Le nom doit contenir de 1 à 80 caractères.' using errcode = 'P0001';
  end if;
  perform private.assert_can_invite_to_role(v_actor.org_id, p_role, v_actor.role, v_actor.keys);
  if exists (select 1 from public.profiles p where p.org_id = v_actor.org_id and pg_catalog.lower(p.email) = v_email) then
    raise exception 'Cette personne a déjà un accès.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.staff_invitations i
              where i.org_id = v_actor.org_id and i.email = v_email and i.status = 'pending') then
    raise exception 'Une invitation est déjà en attente pour cette adresse. Utilisez « Renvoyer ».' using errcode = 'P0001';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:create_staff_invitation', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  v_link := private.issue_secure_link(v_actor.org_id, 'staff_invite', 'staff_invitation', v_id, p_token_hash, p_actor);
  insert into public.staff_invitations (id, org_id, email, display_name, role, secure_link_id, invited_by)
  values (v_id, v_actor.org_id, v_email, v_name, p_role, v_link, p_actor);
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return query
    select v_id, l.expires_at from public.secure_links l where l.id = v_link;
end;
$$;

revoke all on function public.create_staff_invitation(uuid, text, text, text, bytea) from public, anon, authenticated;
grant execute on function public.create_staff_invitation(uuid, text, text, text, bytea) to service_role;

-- -----------------------------------------------------------------------------
-- list_staff_invitations also returns the last email's error code
-- -----------------------------------------------------------------------------
-- Same body as *_core_staff_invitations.sql plus last_email_error_code (null unless that email
-- failed: email_log's check ties error_code to status 'failed').
drop function public.list_staff_invitations();

create function public.list_staff_invitations()
returns table (
  id uuid,
  email text,
  display_name text,
  role text,
  role_name text,
  status text,
  expires_at timestamptz,
  is_expired boolean,
  invited_by_name text,
  created_at timestamptz,
  last_email_status text,
  last_email_at timestamptz,
  last_email_error_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
begin
  if not private.has_permission('users.view') then
    raise exception 'Permission refusée : users.view' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();
  return query
    select i.id, i.email, i.display_name, i.role, ro.name, i.status, l.expires_at,
           coalesce(l.expires_at <= pg_catalog.now(), true), ip.display_name, i.created_at, e.status, e.created_at,
           e.error_code
      from public.staff_invitations i
      left join public.roles ro on ro.key = i.role
      left join public.secure_links l on l.id = i.secure_link_id
      left join public.profiles ip on ip.user_id = i.invited_by
      left join lateral (
        select el.status, el.created_at, el.error_code from public.email_log el
         where el.org_id = i.org_id and el.subject_type = 'staff_invitation' and el.subject_id = i.id
         order by el.created_at desc, el.id desc
         limit 1
      ) e on true
     where i.org_id = v_org and i.status = 'pending'
     order by i.created_at desc, i.id desc;
end;
$$;

revoke all on function public.list_staff_invitations() from public, anon, authenticated, service_role;
grant execute on function public.list_staff_invitations() to authenticated;
