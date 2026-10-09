-- =============================================================================
-- « Supprimer le compte » in « Utilisateurs et accès »
-- =============================================================================
-- Rules:   docs/standards/database-conventions.md
-- Caller:  the user edge function `users-delete` (core), which calls delete_staff_account as the
--          caller, then deletes the Auth user with the service role.
--
-- Key choices
-- * delete_staff_account(p_user_id) (authenticated, definer). Guards, in order: users.manage
--   (42501); not oneself; a profile of the caller's clinic (another clinic's, or an unknown id,
--   reads « Utilisateur introuvable. », like every user RPC); only an admin deletes an admin;
--   the account is disabled first; then each module guard. « Disabled first » also keeps the
--   last active admin: an active admin is never deleted, and the last one cannot be disabled
--   (the profiles / user_roles last-admin triggers stay the backstop on every write path).
--   The target profile is locked (FOR UPDATE) before the checks, so a concurrent re-enable waits.
-- * Module guards are data (ADR 0003): `account_deletion_guards` names, per module, a private
--   function `(p_org uuid, p_user_id uuid) returns text` answering null, or the French sentence
--   of its refusal (raised P0001). Seeded by the module's own migration; invoker, granted to no
--   role (it runs inside this definer RPC). Every guard runs whether its module is enabled or
--   not: a disabled module's rows still point at the account.
-- * What goes: the profile, and by cascade its role, permission overrides, preferences,
--   notifications addressed to it and notification reads; the clinic's invitations to the
--   person (her address, or accepted by her: they hold her address and name; a pending one's
--   link is revoked first). Actor columns elsewhere (updated_by, created_by, sent_by…) become
--   null, as their foreign keys say. What stays: audit_log (actor ids carry no FK, the UI reads
--   an actor without a profile as « Compte supprimé »), email_log (operational, its own
--   retention).
-- * Loi 25: the call sets the transaction-local `app.audit_redact = 'email,display_name'`, and
--   private.audit_trigger now also redacts the columns that setting lists. The deletion's own
--   audit rows (the profile, its cascades, the invitations) therefore keep no identifier: the
--   profile's delete row is the non-identifying trace of who deleted which account (actor = the
--   caller, record_id = the user id, source rpc:delete_staff_account). Rows written before stay
--   as they are (append-only). The setting is put back on return.
-- * Idempotent: for an account this clinic already deleted (its profile's delete row from
--   rpc:delete_staff_account in the clinic's audit_log, and no profile left anywhere) the call
--   answers 'already_deleted' and changes nothing, so users-delete can retry the Auth deletion.
--   The guards before it (users.manage, oneself) still apply. A first call answers 'deleted'.
-- * Backstop: core.invite_orphans_purge also deletes, an hour later, the Auth users whose
--   profile delete_staff_account removed. A failed Auth deletion nobody retried would otherwise
--   keep the address taken (a new invitation could not create the account). Same owner and
--   cascade as the invitation orphans (*_core_staff_access_followups.sql).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_delete_staff_account', true);

-- -----------------------------------------------------------------------------
-- Module guards (catalogue)
-- -----------------------------------------------------------------------------
create table public.account_deletion_guards (
  module_key text primary key references public.modules(key),
  -- A private function (p_org uuid, p_user_id uuid) returns text; core calls it by name.
  guard_function text not null unique check (guard_function ~ '^private\.[a-z][a-z0-9_]{2,62}$'),
  created_at timestamptz not null default now()
);

alter table public.account_deletion_guards enable row level security;
-- No client privilege and no policy: only delete_staff_account (definer) reads it.
revoke all on public.account_deletion_guards from anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.audit_trigger: also redacts the columns app.audit_redact lists
-- -----------------------------------------------------------------------------
-- Same signature, grants and body as *_core_staff_invitations.sql, plus the second redaction
-- loop. The setting is a comma-separated column list, set transaction-locally by an RPC that
-- removes a person (delete_staff_account) and put back before it returns.
create or replace function private.audit_trigger()
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
  -- A service RPC acting for a user names her in app.audit_actor; never consulted for a user's JWT.
  v_actor uuid := case
    when auth.role() is not distinct from 'authenticated' then auth.uid()
    else coalesce(nullif(pg_catalog.current_setting('app.audit_actor', true), '')::uuid, auth.uid())
  end;
  v_actor_role text;
  v_column text;
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
  -- Asked by the transaction (app.audit_redact): a person's removal keeps no identifier.
  foreach v_column in array pg_catalog.string_to_array(coalesce(pg_catalog.current_setting('app.audit_redact', true), ''), ',') loop
    v_column := pg_catalog.btrim(v_column);
    if v_column <> '' and v_changed ? v_column then
      v_changed := pg_catalog.jsonb_set(v_changed, array[v_column], '"[redacted]"'::jsonb);
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

-- -----------------------------------------------------------------------------
-- delete_staff_account
-- -----------------------------------------------------------------------------
create function public.delete_staff_account(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_target record;
  v_role text;
  v_guard record;
  v_proc regprocedure;
  v_refusal text;
  v_invitation uuid;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_redact text := pg_catalog.current_setting('app.audit_redact', true);
begin
  if not private.has_permission('users.manage') then
    raise exception 'Permission refusée : users.manage' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'Utilisateur manquant' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas supprimer votre propre compte.' using errcode = 'P0001';
  end if;

  select p.user_id, pg_catalog.lower(p.email) as email, p.status into v_target
    from public.profiles p
   where p.user_id = p_user_id and p.org_id = v_org
     for update;
  if not found then
    -- Already deleted by this clinic: the retry of a failed Auth deletion (header).
    if not exists (select 1 from public.profiles p where p.user_id = p_user_id)
       and exists (select 1 from public.audit_log a
                    where a.table_name = 'profiles' and a.record_id = p_user_id::text and a.action = 'delete'
                      and a.org_id = v_org and a.source = 'rpc:delete_staff_account') then
      return 'already_deleted';
    end if;
    raise exception 'Utilisateur introuvable.' using errcode = 'P0001';
  end if;

  select r.role into v_role from public.user_roles r where r.user_id = p_user_id;
  if v_role = 'admin' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut supprimer un administrateur.' using errcode = 'P0001';
  end if;
  if v_target.status <> 'disabled' then
    raise exception 'Désactivez d''abord le compte.' using errcode = 'P0001';
  end if;

  for v_guard in select g.guard_function from public.account_deletion_guards g order by g.module_key loop
    v_proc := pg_catalog.to_regprocedure(v_guard.guard_function || '(uuid, uuid)');
    if v_proc is null then
      raise exception 'Garde de suppression introuvable : %', v_guard.guard_function using errcode = '55000';
    end if;
    execute pg_catalog.format('select %s($1, $2)', v_proc::regproc) into v_refusal using v_org, p_user_id;
    if v_refusal is not null then
      raise exception '%', v_refusal using errcode = 'P0001';
    end if;
  end loop;

  perform pg_catalog.set_config('app.audit_source', 'rpc:delete_staff_account', true);
  perform pg_catalog.set_config('app.audit_redact', 'email,display_name', true);
  for v_invitation in
    select i.id from public.staff_invitations i
     where i.org_id = v_org and i.status = 'pending' and i.email = v_target.email
  loop
    perform private.revoke_secure_links(v_org, 'staff_invite', 'staff_invitation', v_invitation, auth.uid());
  end loop;
  delete from public.staff_invitations i
   where i.org_id = v_org and (i.accepted_user_id = p_user_id or i.email = v_target.email);
  -- Cascades: user_roles, user_permission_overrides, user_preferences, notifications to her,
  -- notification_reads; actor columns elsewhere become null.
  delete from public.profiles p where p.user_id = p_user_id and p.org_id = v_org;
  perform pg_catalog.set_config('app.audit_redact', coalesce(v_prev_redact, ''), true);
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return 'deleted';
end;
$$;

revoke all on function public.delete_staff_account(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_staff_account(uuid) to authenticated;
-- service_role is revoked: it acts for the calling user (auth.uid()), which a service caller lacks.

-- -----------------------------------------------------------------------------
-- core.invite_orphans_purge: also the Auth users of deleted accounts
-- -----------------------------------------------------------------------------
-- Same signature, grants and job as *_core_staff_access_followups.sql; a second branch. An Auth
-- user with a profile is never deleted.
create or replace function private.job_invite_orphans_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from auth.users u
   where not exists (select 1 from public.profiles p where p.user_id = u.id)
     and (
       (u.raw_app_meta_data ? 'invite_link_id'
        and u.last_sign_in_at is null
        and u.created_at < pg_catalog.now() - interval '1 hour')
       or exists (select 1 from public.audit_log a
                   where a.table_name = 'profiles' and a.record_id = u.id::text and a.action = 'delete'
                     and a.source = 'rpc:delete_staff_account'
                     and a.created_at < pg_catalog.now() - interval '1 hour')
     );
  get diagnostics v_deleted = row_count;
  return 'deleted=' || v_deleted;
end;
$$;

update public.scheduled_jobs
   set label = 'Purge des comptes de connexion orphelins',
       description = 'Supprime, après une heure, les comptes de connexion restés sans utilisateur : ceux d''une acceptation d''invitation qui n''a pas abouti (la personne peut alors accepter de nouveau) et ceux d''un compte supprimé dont la suppression n''a pas pu être terminée.'
 where key = 'core.invite_orphans_purge';
