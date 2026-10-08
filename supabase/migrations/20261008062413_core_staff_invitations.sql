-- =============================================================================
-- Staff invitations: accounts created only on acceptance, through a secure link
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §4 (decision #22)
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.18 (P3-7, P3-8, P3-16,
--          inconsistency #15)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The staff-invite function generates the token and calls create / renew with the USER client,
--   so the guards below apply to the caller; only the SHA-256 reaches the database (P3-7).
-- * Guards, the same as set_user_role's (decision #28, Task 2.20), applied by create AND renew
--   (renew issues a token the caller could choose, so it is a new invitation to that role):
--   users.manage; the role must be a base role or one of the org's custom roles (« Ce rôle
--   n'existe plus. », HINT role_missing, private.assert_org_role); provider is the Professionnels
--   module's; only an admin invites an admin; a non-admin never invites to a role carrying a
--   permission she lacks (hold rule, on the org's defaults).
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
--   messages; renew applies the role guards and refuses an address that has gained access;
--   service_role has no privilege on the table (RPCs only, like secure_links); the purpose key is
--   `staff_invite` (purpose keys have no dot; `core.staff_invite` is the email template).
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
-- Guard shared by create and renew
-- -----------------------------------------------------------------------------
-- Raises unless the caller (users.manage already checked, org row locked) may invite someone to
-- p_role in p_org. Same rules and order as set_user_role.
create function private.assert_can_invite_to_role(p_org uuid, p_role text)
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
  if p_role = 'admin' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut inviter un administrateur.' using errcode = 'P0001';
  end if;
  -- Fails closed like set_user_role: has_permission is false for a disabled module.
  if not private.has_role('admin') and exists (
    select 1 from public.org_role_permissions rp
     where rp.org_id = p_org and rp.role = p_role and not private.has_permission(rp.permission_key)
  ) then
    raise exception 'Vous ne pouvez pas inviter à un rôle qui donne des permissions que vous n''avez pas.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.assert_can_invite_to_role(uuid, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- User RPCs (staff-invite function, « Utilisateurs et accès »)
-- -----------------------------------------------------------------------------
-- Creates a pending invitation and its link; returns the invitation id. The address is trimmed
-- and lowercased, the name trimmed. p_token_hash: SHA-256 of the token the function emails.
create function public.create_staff_invitation(p_email text, p_display_name text, p_role text, p_token_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email, E' \t\r\n'));
  v_name text := pg_catalog.btrim(p_display_name, E' \t\r\n');
  v_id uuid := gen_random_uuid();
  v_link uuid;
begin
  if not private.has_permission('users.manage') then
    raise exception 'Permission refusée : users.manage' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();
  perform 1 from public.organizations o where o.id = v_org for no key update;

  if v_email is null or pg_catalog.length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse courriel invalide.' using errcode = 'P0001';
  end if;
  if coalesce(pg_catalog.length(v_name), 0) not between 1 and 80 then
    raise exception 'Le nom doit contenir de 1 à 80 caractères.' using errcode = 'P0001';
  end if;
  perform private.assert_can_invite_to_role(v_org, p_role);
  if exists (select 1 from public.profiles p where p.org_id = v_org and pg_catalog.lower(p.email) = v_email) then
    raise exception 'Cette personne a déjà un accès.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.staff_invitations i where i.org_id = v_org and i.email = v_email and i.status = 'pending') then
    raise exception 'Une invitation est déjà en attente pour cette adresse. Utilisez « Renvoyer ».' using errcode = 'P0001';
  end if;

  v_link := private.issue_secure_link(v_org, 'staff_invite', 'staff_invitation', v_id, p_token_hash, auth.uid());
  insert into public.staff_invitations (id, org_id, email, display_name, role, secure_link_id, invited_by)
  values (v_id, v_org, v_email, v_name, p_role, v_link, auth.uid());
  return v_id;
end;
$$;

-- « Renvoyer »: a new link for a pending invitation (the previous one is revoked, expired or not)
-- and what the email needs. The role guards apply again: the caller chooses the new token.
create function public.renew_staff_invitation(p_id uuid, p_token_hash bytea)
returns table (email text, display_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_inv public.staff_invitations%rowtype;
  v_link uuid;
begin
  if not private.has_permission('users.manage') then
    raise exception 'Permission refusée : users.manage' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();
  perform 1 from public.organizations o where o.id = v_org for no key update;

  select * into v_inv from public.staff_invitations i
   where i.id = p_id and i.org_id = v_org and i.status = 'pending'
     for update;
  if not found then
    raise exception 'Cette invitation n''est plus en attente.' using errcode = 'P0001';
  end if;
  perform private.assert_can_invite_to_role(v_org, v_inv.role);
  if exists (select 1 from public.profiles p where p.org_id = v_org and pg_catalog.lower(p.email) = v_inv.email) then
    raise exception 'Cette personne a déjà un accès.' using errcode = 'P0001';
  end if;

  v_link := private.issue_secure_link(v_org, 'staff_invite', 'staff_invitation', v_inv.id, p_token_hash, auth.uid());
  update public.staff_invitations i set secure_link_id = v_link where i.id = v_inv.id;
  return query
    select v_inv.email, v_inv.display_name, l.expires_at from public.secure_links l where l.id = v_link;
end;
$$;

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
  public.create_staff_invitation(text, text, text, bytea),
  public.renew_staff_invitation(uuid, bytea),
  public.revoke_staff_invitation(uuid),
  public.list_staff_invitations()
from public, anon, authenticated, service_role;
grant execute on function
  public.create_staff_invitation(text, text, text, bytea),
  public.renew_staff_invitation(uuid, bytea),
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
