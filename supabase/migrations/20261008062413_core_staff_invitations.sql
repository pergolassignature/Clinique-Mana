-- =============================================================================
-- Staff invitations: accounts created only on acceptance, through a secure link
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §4 (decision #22)
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.18 (P3-7, P3-8, P3-16,
--          inconsistency #15)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The inviter never learns the token (P3-7). The link proves that the invitee controls the
--   address only if nobody else knows the token. If a manager could choose the hash, she could
--   invite any address and accept the invitation herself. So create_staff_invitation and
--   renew_staff_invitation are SERVICE ROLE ONLY and take the actor explicitly:
--     create_staff_invitation(p_actor uuid, p_email text, p_display_name text, p_role text,
--                             p_token_hash bytea) returns uuid
--     renew_staff_invitation(p_actor uuid, p_id uuid, p_token_hash bytea)
--       returns table (email text, display_name text, expires_at timestamptz)
--   Contract with the staff-invite function (Task 3.20), the only caller:
--     1. verifyAuth(req, { permission: 'users.manage' }) authenticates the user;
--     2. it generates the token (generateToken) and hashes it (hashToken), in memory;
--     3. it calls the RPC with the SERVICE client and p_actor = that verified user's id
--        (auth.access.user_id), never an id taken from the request body;
--     4. it emails the link. The token is never returned to the browser, logged or stored; only
--        its SHA-256 reaches the database.
--   The RPCs re-check everything as p_actor and never trust the function's own check: an active
--   member of an org holding users.manage (otherwise 42501, also for a null, unknown or disabled
--   actor); the org is the actor's profile's, never an argument; invited_by, the link's
--   created_by and the revoked link's revoked_by are p_actor. revoke_staff_invitation and
--   list_staff_invitations involve no token and stay user RPCs (authenticated, auth.uid()).
-- * The actor's permissions come from private.permission_keys_for(p_user), the body of
--   current_permission_keys() with the user as a parameter; current_permission_keys() is now a
--   plpgsql wrapper calling it with auth.uid(). Same result, grants and volatility; measured at
--   the same cost per call (about 21 µs locally, 20 000 calls: the plpgsql wrapper caches its
--   plan, while a `language sql` wrapper was 5× slower). has_permission is unchanged. The new
--   function answers for any user, so no client role may call it.
-- * Audit attribution: auth.uid() is null under the service role, so the two service RPCs set
--   `app.audit_actor` (and `app.audit_source` = rpc:<name>) for their own statements and restore
--   them before returning. private.audit_trigger uses app.audit_actor only when auth.uid() is
--   null, so an authenticated caller cannot be misattributed. The rest of its body is unchanged.
-- * Guards, the same as set_user_role's (decision #28, Task 2.20), evaluated for the actor and
--   applied by create AND renew (a renewal is a new link to that role): users.manage; the role
--   must be a base role or one of the org's custom roles (« Ce rôle n'existe plus. », HINT
--   role_missing, private.assert_org_role); provider is the Professionnels module's; only an
--   admin invites an admin; a non-admin never invites to a role carrying a permission she lacks
--   (hold rule, on the org's defaults; a disabled module's permissions count as lacking).
-- * Neutral (P3-8, decision #38): only an address with a profile in THIS org is refused (users.view
--   already lists it). An address with an account elsewhere is invited like any other; the
--   accept-invite function meets it at createUser and answers the generic « Ce lien ne peut plus
--   être utilisé… ». Nothing here reads auth.users at invitation time.
-- * The account exists only once accepted. accept_staff_invitation (service role, the purpose's
--   accept_rpc) consumes the link, creates the profile and the role, and marks the invitation
--   accepted in one transaction. A link that cannot be consumed answers its state as peek would
--   (link_used / link_expired / link_invalid: the accept function's 410 codes) and writes nothing;
--   the function then deletes the auth user it created. An auth user whose address is not the
--   invitation's raises 22023, so the consumption rolls back too.
-- * Locks: every writer takes the org row first (FOR NO KEY UPDATE), then the link
--   (issue_secure_link's advisory lock and row updates), then the invitation row. accept reads
--   the link's org without a lock, locks the org, then consumes; so renew, revoke, accept and
--   delete_role serialize per org and cannot deadlock. No existing profile is locked.
-- * `role` is set null when its custom role is deleted, for non-pending invitations only:
--   delete_role refuses a role with pending invitations with a French message (inconsistency #15).
--   A trigger (private.check_role_org) keeps the role in the invitation's org.
-- * Expiry is the link's (« Expirée » when expires_at has passed); a pending invitation stays
--   pending until accepted or revoked, and « Renvoyer » renews it.
-- * Deviations from the plan: an unknown or another org's role is « Ce rôle n'existe plus. »
--   (P0001, as every role RPC since Task 2.20) instead of 22023; malformed input gets French P0001
--   messages; create and renew are service-role RPCs with p_actor (above), not user RPCs; renew
--   applies the role guards and refuses an address that has gained access; service_role has no
--   privilege on the table (RPCs only, like secure_links); the purpose key is `staff_invite`
--   (purpose keys have no dot; `core.staff_invite` is the email template).
-- * No PS Hub equivalent (it creates staff accounts directly with admin-create-user).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_staff_invitations', true);

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null
    check (email = pg_catalog.lower(pg_catalog.btrim(email)) and pg_catalog.length(email) <= 254
           and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Same rule as profiles.display_name: it becomes the profile's name.
  display_name text not null
    check (pg_catalog.length(display_name) <= 80 and pg_catalog.length(pg_catalog.btrim(display_name, E' \t\r\n')) >= 1),
  role text references public.roles(key) on delete set null,
  -- The current link; a renewal points it at the new one. Null once the link is purged (12 months).
  secure_link_id uuid unique references public.secure_links(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references public.profiles(user_id) on delete set null,
  accepted_user_id uuid references public.profiles(user_id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'pending' or role is not null),
  check ((status = 'accepted') = (accepted_at is not null))
);
-- One pending invitation per address and org (« Utilisez « Renvoyer » »).
create unique index staff_invitations_pending_email_key on public.staff_invitations (org_id, email)
  where status = 'pending';
-- The org FK, the select policy and list_staff_invitations.
create index staff_invitations_org_created_idx on public.staff_invitations (org_id, created_at desc, id desc);
-- The role FK and delete_role's pending count.
create index staff_invitations_role_idx on public.staff_invitations (role);
create index staff_invitations_invited_by_idx on public.staff_invitations (invited_by) where invited_by is not null;
create index staff_invitations_accepted_user_id_idx on public.staff_invitations (accepted_user_id)
  where accepted_user_id is not null;

alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon, authenticated, service_role;
grant select on public.staff_invitations to authenticated;
create policy staff_invitations_select on public.staff_invitations
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('users.view'))
  );

create trigger staff_invitations_set_updated_at
  before update on public.staff_invitations
  for each row execute function private.set_updated_at();
create trigger staff_invitations_check_role_org
  before insert or update of role, org_id on public.staff_invitations
  for each row execute function private.check_role_org();
create trigger staff_invitations_audit
  after insert or update or delete on public.staff_invitations
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Purpose (handlers below; 020_core_secure_links checks their contract)
-- -----------------------------------------------------------------------------
insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, creates_account, resolve_rpc, accept_rpc, view_permission)
values ('staff_invite', 'core', interval '7 days', interval '14 days', 1, true,
        'resolve_staff_invitation', 'accept_staff_invitation', 'users.view')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- One permission source, for any user
-- -----------------------------------------------------------------------------
-- p_user's effective permission keys, sorted; '{}' without an active profile and a role, or for
-- a null user. The body is current_permission_keys()'s (*_core_shared_permissions.sql) with
-- auth.uid() replaced by p_user. Server-side only: it answers for anyone.
create function private.permission_keys_for(p_user uuid)
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
  -- The permissions whose module is on for the user's org.
  perm as (
    select pm.key
      from public.permissions pm
     cross join me
     where pm.module_key = 'core'
        or exists (
             select 1 from public.org_modules om
              where om.org_id = me.org_id
                and om.module_key = pm.module_key
                and om.enabled)
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

revoke all on function private.permission_keys_for(uuid) from public, anon, authenticated, service_role;

-- Same signature, result, grants (create or replace keeps them), stable and security definer.
-- plpgsql, not sql: a definer sql wrapper is never inlined and re-plans the inner call each time
-- (5× slower measured); plpgsql caches its plan and costs what the old body did.
create or replace function private.current_permission_keys()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.permission_keys_for(auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit actor for service RPCs acting for a user
-- -----------------------------------------------------------------------------
-- Same signature, grants and body as *_core_audit.sql, except the actor: auth.uid(), else
-- app.audit_actor (set by create / renew_staff_invitation, which run under the service role).
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
  v_actor uuid := coalesce(auth.uid(), nullif(pg_catalog.current_setting('app.audit_actor', true), '')::uuid);
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

-- -----------------------------------------------------------------------------
-- Guard shared by create and renew
-- -----------------------------------------------------------------------------
-- Raises unless an actor with role p_actor_role and permissions p_actor_keys (users.manage
-- already checked, org row locked) may invite someone to p_role in p_org. Same rules and order as
-- set_user_role. A disabled module's permissions are absent from p_actor_keys, so the hold rule
-- fails closed like set_user_role's.
create function private.assert_can_invite_to_role(p_org uuid, p_role text, p_actor_role text, p_actor_keys text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_org_role(p_org, p_role);
  if p_role = 'provider' then
    raise exception 'Le rôle Professionnel est attribué par le module Professionnels.' using errcode = 'P0001';
  end if;
  if p_role = 'admin' and p_actor_role is distinct from 'admin' then
    raise exception 'Seul un administrateur peut inviter un administrateur.' using errcode = 'P0001';
  end if;
  if p_actor_role is distinct from 'admin' and exists (
    select 1 from public.org_role_permissions rp
     where rp.org_id = p_org and rp.role = p_role
       and not coalesce(rp.permission_key = any (p_actor_keys), false)
  ) then
    raise exception 'Vous ne pouvez pas inviter à un rôle qui donne des permissions que vous n''avez pas.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Raises 42501 unless p_actor is an active member holding users.manage (a null, unknown, disabled
-- or role-less actor holds nothing); returns her org, role and permissions. The org is the
-- actor's, never the caller's choice.
create function private.staff_inviter(p_actor uuid, out org_id uuid, out role text, out keys text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  keys := private.permission_keys_for(p_actor);
  if not ('users.manage' = any (keys)) then
    raise exception 'Permission refusée : users.manage' using errcode = '42501';
  end if;
  -- Non-empty keys imply an active profile with a role.
  select p.org_id, r.role into org_id, role
    from public.profiles p
    join public.user_roles r on r.user_id = p.user_id
   where p.user_id = p_actor and p.status = 'active';
end;
$$;

revoke all on function
  private.assert_can_invite_to_role(uuid, text, text, text[]),
  private.staff_inviter(uuid)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Service RPCs (the staff-invite function only, p_actor = the verified caller)
-- -----------------------------------------------------------------------------
-- Creates a pending invitation and its link for p_actor's org; returns the invitation id. The
-- address is trimmed and lowercased, the name trimmed. p_token_hash: SHA-256 of the token the
-- function generated and emails; the token itself never leaves the function.
create function public.create_staff_invitation(
  p_actor uuid, p_email text, p_display_name text, p_role text, p_token_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email, E' \t\r\n'));
  v_name text := pg_catalog.btrim(p_display_name, E' \t\r\n');
  v_id uuid := gen_random_uuid();
  v_link uuid;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  select * into v_actor from private.staff_inviter(p_actor);
  perform 1 from public.organizations o where o.id = v_actor.org_id for no key update;

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
  return v_id;
end;
$$;

-- « Renvoyer »: a new link for a pending invitation of p_actor's org (the previous one is revoked,
-- expired or not) and what the email needs. The role guards apply again: a renewal is a new link
-- to that role.
create function public.renew_staff_invitation(p_actor uuid, p_id uuid, p_token_hash bytea)
returns table (email text, display_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor record;
  v_inv public.staff_invitations%rowtype;
  v_link uuid;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  select * into v_actor from private.staff_inviter(p_actor);
  perform 1 from public.organizations o where o.id = v_actor.org_id for no key update;

  select * into v_inv from public.staff_invitations i
   where i.id = p_id and i.org_id = v_actor.org_id and i.status = 'pending'
     for update;
  if not found then
    raise exception 'Cette invitation n''est plus en attente.' using errcode = 'P0001';
  end if;
  perform private.assert_can_invite_to_role(v_actor.org_id, v_inv.role, v_actor.role, v_actor.keys);
  if exists (select 1 from public.profiles p where p.org_id = v_actor.org_id and pg_catalog.lower(p.email) = v_inv.email) then
    raise exception 'Cette personne a déjà un accès.' using errcode = 'P0001';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:renew_staff_invitation', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  v_link := private.issue_secure_link(v_actor.org_id, 'staff_invite', 'staff_invitation', v_inv.id, p_token_hash, p_actor);
  update public.staff_invitations i set secure_link_id = v_link where i.id = v_inv.id;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return query
    select v_inv.email, v_inv.display_name, l.expires_at from public.secure_links l where l.id = v_link;
end;
$$;

revoke all on function
  public.create_staff_invitation(uuid, text, text, text, bytea),
  public.renew_staff_invitation(uuid, uuid, bytea)
from public, anon, authenticated;
grant execute on function
  public.create_staff_invitation(uuid, text, text, text, bytea),
  public.renew_staff_invitation(uuid, uuid, bytea)
to service_role;

-- -----------------------------------------------------------------------------
-- User RPCs (« Utilisateurs et accès »): no token involved
-- -----------------------------------------------------------------------------
-- « Révoquer »: the invitation and its link.
create function public.revoke_staff_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not private.has_permission('users.manage') then
    raise exception 'Permission refusée : users.manage' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();
  perform 1 from public.organizations o where o.id = v_org for no key update;

  update public.staff_invitations i set status = 'revoked'
   where i.id = p_id and i.org_id = v_org and i.status = 'pending';
  if not found then
    raise exception 'Cette invitation n''est plus en attente.' using errcode = 'P0001';
  end if;
  perform private.revoke_secure_links(v_org, 'staff_invite', 'staff_invitation', p_id, auth.uid());
end;
$$;

-- The org's pending invitations, newest first, in one query: the link's expiry and the last
-- email about each (email_log_subject_idx, one row). Unpaged like list_org_users: one pending
-- invitation per address, and accepted or revoked ones drop out.
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
  last_email_at timestamptz
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
           coalesce(l.expires_at <= pg_catalog.now(), true), ip.display_name, i.created_at, e.status, e.created_at
      from public.staff_invitations i
      left join public.roles ro on ro.key = i.role
      left join public.secure_links l on l.id = i.secure_link_id
      left join public.profiles ip on ip.user_id = i.invited_by
      left join lateral (
        select el.status, el.created_at from public.email_log el
         where el.org_id = i.org_id and el.subject_type = 'staff_invitation' and el.subject_id = i.id
         order by el.created_at desc, el.id desc
         limit 1
      ) e on true
     where i.org_id = v_org and i.status = 'pending'
     order by i.created_at desc, i.id desc;
end;
$$;

revoke all on function
  public.revoke_staff_invitation(uuid),
  public.list_staff_invitations()
from public, anon, authenticated, service_role;
grant execute on function
  public.revoke_staff_invitation(uuid),
  public.list_staff_invitations()
to authenticated;
-- service_role is revoked (Supabase's default privileges grant it EXECUTE): these act for the
-- calling user (auth.uid()).

-- -----------------------------------------------------------------------------
-- Purpose handlers (service role: resolve-link, accept-invite; P3-16)
-- -----------------------------------------------------------------------------
-- What /invitation shows for a valid link: the clinic, the invitee's own name and address (the
-- token proves the address), the expiry. Null when the link is no longer the pending invitation's
-- (revoked or renewed between peek and resolve): the function answers link_invalid.
create function public.resolve_staff_invitation(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'clinic_name', o.name,
           'display_name', i.display_name,
           'email', i.email,
           'expires_at', l.expires_at)
    from public.staff_invitations i
    join public.secure_links l on l.id = i.secure_link_id
    join public.organizations o on o.id = i.org_id
   where i.secure_link_id = p_link_id and i.status = 'pending'
$$;

-- Called by accept-invite after it created p_user_id (auth.admin.createUser with the invitation's
-- address). One transaction: consume the link, create the profile and the role, accept. Answers
--   {"status": "accepted", "org_id": …}
--   {"status": "link_used" | "link_expired" | "link_invalid"}   nothing written; the function
--                                                               deletes the user it created
-- p_payload is unused (staff invitations take no form data). 22023 (everything rolled back, the
-- link stays usable) when p_user_id is not an auth user with the invitation's address; 23505 when
-- it already has a profile.
create function public.accept_staff_invitation(p_token_hash bytea, p_user_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_link public.secure_links%rowtype;
  v_inv public.staff_invitations%rowtype;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  -- Lock order org → link → invitation, like renew and revoke: read the link's org unlocked first.
  select l.org_id into v_org from public.secure_links l
   where l.token_hash = p_token_hash and l.purpose = 'staff_invite';
  if not found then
    return '{"status": "link_invalid"}'::jsonb;
  end if;
  perform 1 from public.organizations o where o.id = v_org for no key update;

  v_link := private.consume_secure_link(p_token_hash, 'staff_invite');
  if v_link.id is null then
    -- Expired, used or revoked since the function's peek: answer what peek would now.
    return pg_catalog.jsonb_build_object('status',
      case public.peek_secure_link(p_token_hash, false) ->> 'state'
        when 'used' then 'link_used' when 'expired' then 'link_expired' else 'link_invalid' end);
  end if;

  select * into v_inv from public.staff_invitations i
   where i.secure_link_id = v_link.id and i.status = 'pending'
     for update;
  if not found then
    raise exception 'Lien sans invitation en attente' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and pg_catalog.lower(u.email) = v_inv.email) then
    raise exception 'Le compte ne correspond pas à l''invitation' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:accept_staff_invitation', true);
  -- profiles.email is copied from auth.users by profiles_email_from_auth.
  insert into public.profiles (user_id, org_id, display_name, email, status)
  values (p_user_id, v_inv.org_id, v_inv.display_name, v_inv.email, 'active');
  insert into public.user_roles (user_id, org_id, role) values (p_user_id, v_inv.org_id, v_inv.role);
  update public.staff_invitations i
     set status = 'accepted', accepted_user_id = p_user_id, accepted_at = pg_catalog.now()
   where i.id = v_inv.id;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  return pg_catalog.jsonb_build_object('status', 'accepted', 'org_id', v_inv.org_id);
end;
$$;

revoke all on function
  public.resolve_staff_invitation(uuid),
  public.accept_staff_invitation(bytea, uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  public.resolve_staff_invitation(uuid),
  public.accept_staff_invitation(bytea, uuid, jsonb)
to service_role;

-- -----------------------------------------------------------------------------
-- delete_role: also refuses a role with pending invitations (inconsistency #15)
-- -----------------------------------------------------------------------------
-- Same signature, body and grants as 20261008015825_core_editable_roles.sql (create or replace
-- keeps the grants), plus the invitation count. Non-pending invitations keep their history with
-- role set null (staff_invitations.role on delete set null).
create or replace function public.delete_role(p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.assert_can_manage_roles();
  v_holders int;
  v_invitations int;
begin
  if not private.assert_org_role(v_org, p_role) then
    raise exception 'Les rôles de base ne peuvent pas être supprimés.' using errcode = 'P0001';
  end if;
  -- After the org lock: a concurrent set_user_role, create_staff_invitation or
  -- accept_staff_invitation naming this role has committed or waits.
  select count(*)::int into v_holders from public.user_roles r where r.role = p_role;
  if v_holders > 0 then
    raise exception 'Ce rôle est attribué à % personne(s).', v_holders using errcode = 'P0001';
  end if;
  select count(*)::int into v_invitations from public.staff_invitations i
   where i.role = p_role and i.status = 'pending';
  if v_invitations > 0 then
    raise exception 'Ce rôle est utilisé par % invitation(s) en attente.', v_invitations using errcode = 'P0001';
  end if;
  delete from public.roles ro where ro.key = p_role;
end;
$$;
