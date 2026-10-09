-- Professionnels: how each invitation link was handed over, and whether its email left
-- (decisions P4-490 – P4-494; Jonathan's request after testing on staging, 2026-10-09).
--
-- Before: « Invitation envoyée le … » read the link's existence, so a link whose email never left
-- (no Resend key: nothing queued, no email_log row) read « envoyée ». Now:
-- * professional_invitation_deliveries: one row per issued link (« Envoyer l'invitation » and the
--   like, the reminders, « Copier le lien d'invitation »): `email` or `copied`, and for an email the
--   failure the function met before anything was queued (`not_configured`, …), which email_log
--   cannot hold. Audited: a copy names who took a link, when, for which file (never the token).
-- * copy_professional_invitation_link (service role, p_actor): « Copier le lien d'invitation »
--   (P4-491, Jonathan reverses P4-260): a new link, the previous one revoked, no email; the
--   function answers the URL once.
-- * record_professional_invitation_email_failure_for_service: the function stamps a pre-queue
--   failure on the link's row.
-- * the onboarding line (get_professional_onboarding, list_professional_invitation_states) carries
--   the link's delivery and its latest invitation email (status and error code, core's
--   private.latest_subject_email), so Aperçu, « Dossier » and « À surveiller » agree.
-- * a copied link gets no reminder: the job would rotate (kill) the link handed over by hand.

-- -----------------------------------------------------------------------------
-- The deliveries
-- -----------------------------------------------------------------------------
create table public.professional_invitation_deliveries (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  link_id uuid not null,
  -- `email`: the link went out by email (or was meant to); `copied`: the inviter took it (P4-491).
  method text not null,
  -- Why the invitation email was not even queued (the function's code), else null: a queued
  -- email's outcome is email_log's.
  email_failure text,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  -- PK starts with professional_id: audit record ids start with it (P4-36), so the history reads it.
  constraint professional_invitation_deliveries_pkey primary key (professional_id, id),
  constraint professional_invitation_deliveries_id_key unique (id),
  constraint professional_invitation_deliveries_link_key unique (link_id),
  constraint professional_invitation_deliveries_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_invitation_deliveries_link_fkey foreign key (link_id)
    references public.secure_links (id) on delete cascade,
  constraint professional_invitation_deliveries_method_check check (method in ('email', 'copied')),
  constraint professional_invitation_deliveries_failure_check check (
    email_failure is null or (method = 'email' and email_failure ~ '^[a-z_]{1,40}$'))
);
create index professional_invitation_deliveries_org_idx on public.professional_invitation_deliveries (org_id, professional_id);
create index professional_invitation_deliveries_created_by_idx on public.professional_invitation_deliveries (created_by);

-- No client reads it: the onboarding RPCs below and the service role do.
revoke all on public.professional_invitation_deliveries from anon, authenticated;
alter table public.professional_invitation_deliveries enable row level security;
create trigger professional_invitation_deliveries_audit
  after insert or update or delete on public.professional_invitation_deliveries
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Issuing a link (one body for « Envoyer l'invitation » and « Copier le lien »)
-- -----------------------------------------------------------------------------
-- create_professional_invitation's body (*_professionals_onboarding.sql, unchanged) plus the
-- delivery row: the actor re-checked in her clinic (active, professionals.invite), no account,
-- not inactive; a new link bound to the address (the previous one revoked); a draft becomes
-- `invited`; the onboarding draft created or pointed at the new link. p_source names the RPC in
-- the audit. Returns {link_id, submission_id, email, first_name, expires_at}.
create function private.create_professional_invitation(
  p_actor uuid, p_id uuid, p_token_hash bytea, p_method text, p_source text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_keys text[];
  v_row public.professionals;
  v_link uuid;
  v_sub uuid;
  v_expires timestamptz;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_actor is null or p_id is null or p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Arguments invalides : acteur, professionnel et empreinte de 32 octets attendus.' using errcode = '22023';
  end if;
  -- The actor's org unlocked, the professional's lock, then the actor's permissions: a change
  -- committed while this waited for the lock is seen (lock before checks, as Task 3.18).
  select p.org_id into v_org from public.profiles p where p.user_id = p_actor;
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = v_org for no key update;
  v_keys := private.permission_keys_for(p_actor);
  if not ('professionals.invite' = any (v_keys))
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = v_org and p.status = 'active') then
    raise exception 'Permission refusée : professionals.invite' using errcode = '42501';
  end if;
  if v_row.id is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  if v_row.profile_id is not null then
    raise exception 'Ce professionnel a déjà un compte.' using errcode = 'P0001', hint = 'account';
  end if;
  if v_row.status = 'inactive' then
    raise exception 'Un dossier inactif ne peut pas recevoir d''invitation.' using errcode = 'P0001', hint = 'status';
  end if;

  perform pg_catalog.set_config('app.audit_source', p_source, true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);

  v_link := private.issue_professional_invitation_link(v_org, p_id, p_token_hash, p_actor);
  insert into public.professional_invitation_deliveries (org_id, professional_id, link_id, method, created_by)
  values (v_org, p_id, v_link, p_method, p_actor);
  if v_row.status = 'draft' then
    update public.professionals p
       set status = 'invited', status_changed_at = pg_catalog.now(), status_changed_by = p_actor
     where p.id = p_id and p.org_id = v_org;
  end if;

  select s.id into v_sub from public.professional_submissions s
   where s.professional_id = p_id and s.org_id = v_org and s.kind = 'onboarding' and s.status = 'draft'
     for update;
  if found then
    update public.professional_submissions s set secure_link_id = v_link where s.id = v_sub;
  elsif exists (select 1 from public.professional_submissions s
                 where s.professional_id = p_id and s.org_id = v_org and s.status in ('draft', 'submitted')) then
    -- An account-less file cannot hold another open submission; refuse rather than guess.
    raise exception 'Une soumission est déjà en cours.' using errcode = 'P0001', hint = 'submission';
  else
    v_sub := private.create_professional_submission(v_org, p_id, 'onboarding', private.submission_sections(), v_link, p_actor);
  end if;

  select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object('link_id', v_link, 'submission_id', v_sub, 'email', v_row.email,
                                       'first_name', v_row.first_name, 'expires_at', v_expires);
end;
$$;
revoke all on function private.create_professional_invitation(uuid, uuid, bytea, text, text)
  from public, anon, authenticated, service_role;

-- Service role only (professionals-invite `send`, `resend`, `new_link`): the link for the email.
create or replace function public.create_professional_invitation(p_actor uuid, p_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.create_professional_invitation(p_actor, p_id, p_token_hash, 'email', 'rpc:create_professional_invitation');
end;
$$;

-- Service role only (professionals-invite `copy_link`, P4-491): the same checks and link, no
-- email; the audit names the actor (source rpc:copy_professional_invitation_link).
create function public.copy_professional_invitation_link(p_actor uuid, p_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.create_professional_invitation(p_actor, p_id, p_token_hash, 'copied', 'rpc:copy_professional_invitation_link');
end;
$$;

-- Service role only (professionals-invite, professionals-invitation-reminders): the invitation
-- email of p_link_id was not queued, for p_code (`not_configured`, `invalid_recipient`, …). Only
-- an emailed link of p_org, and only its first failure: a later call changes nothing.
create function public.record_professional_invitation_email_failure_for_service(p_org uuid, p_link_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if p_org is null or p_link_id is null or p_code is null or p_code !~ '^[a-z_]{1,40}$' then
    raise exception 'Arguments invalides : organisation, lien et code attendus.' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:record_professional_invitation_email_failure_for_service', true);
  update public.professional_invitation_deliveries d
     set email_failure = p_code
   where d.org_id = p_org and d.link_id = p_link_id and d.method = 'email' and d.email_failure is null;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

-- -----------------------------------------------------------------------------
-- The reminders: a copied link is never rotated by the job; a re-issued link is an emailed one
-- -----------------------------------------------------------------------------
create or replace function private.professional_invitations_due_for_reminder(p_org uuid, p_id uuid, p_limit int)
returns table (professional_id uuid, link_id uuid, created_by uuid)
language sql
stable
set search_path = ''
as $$
  with d as (
    select (private.professionals_setting(p_org, 'invitation_reminder_after_days') #>> '{}')::int as days
  )
  select p.id, l.id, l.created_by
    from d
    join public.professionals p on p.org_id = p_org and (p_id is null or p.id = p_id)
    join public.secure_links l
      on l.org_id = p_org and l.purpose = 'professional_invite' and l.subject_type = 'professional'
     and l.subject_id = p.id and l.revoked_at is null and l.use_count < l.max_uses
   where d.days is not null
     and p.profile_id is null and p.status <> 'inactive'
     and l.expires_at > pg_catalog.now()
     and l.last_opened_at is null
     and l.created_at <= pg_catalog.now() - pg_catalog.make_interval(days => d.days)
     and not exists (select 1 from public.email_log e
                      where e.org_id = p_org and e.subject_type = 'professional' and e.subject_id = p.id
                        and e.template_key = 'professionals.invite_reminder' and e.created_at >= l.created_at)
     -- P4-493: the link handed over by hand stays the one that works.
     and not exists (select 1 from public.professional_invitation_deliveries x
                      where x.link_id = l.id and x.method = 'copied')
     and exists (select 1 from public.profiles pr
                  where pr.user_id = l.created_by and pr.org_id = p_org and pr.status = 'active')
     and 'professionals.invite' = any (private.permission_keys_for(l.created_by))
   order by l.created_at, l.id
   limit greatest(least(coalesce(p_limit, 100), 500), 1)
$$;

-- *_professionals_onboarding_functions.sql's body plus the delivery row (`email`, by the system).
create or replace function public.reissue_professional_invitation_for_service(p_org uuid, p_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.professionals;
  v_due_link uuid;
  v_inviter uuid;
  v_link uuid;
  v_expires timestamptz;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_org is null or p_id is null or p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Arguments invalides : organisation, professionnel et empreinte de 32 octets attendus.' using errcode = '22023';
  end if;
  -- The professional's lock first (the order of every writer of these links), then the rule.
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = p_org for no key update;
  if not found then
    return null;
  end if;
  select r.link_id, r.created_by into v_due_link, v_inviter
    from private.professional_invitations_due_for_reminder(p_org, p_id, 1) r;
  if v_due_link is null then
    return null;
  end if;

  perform pg_catalog.set_config('app.audit_source', 'job:professionals.invitation_reminders', true);
  perform pg_catalog.set_config('app.audit_actor', '', true);

  -- The original inviter stays the link's author: the acceptance re-checks her (P3-31). The
  -- clinic's lifetime and the file's address in the scope (P4-300): the acceptance refuses a
  -- professional_invite link without it.
  v_link := private.issue_professional_invitation_link(p_org, p_id, p_token_hash, v_inviter);
  insert into public.professional_invitation_deliveries (org_id, professional_id, link_id, method, created_by)
  values (p_org, p_id, v_link, 'email', null);
  update public.professional_submissions s
     set secure_link_id = v_link
   where s.professional_id = p_id and s.org_id = p_org and s.kind = 'onboarding' and s.status = 'draft';

  select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object('link_id', v_link, 'email', v_row.email, 'first_name', v_row.first_name,
                                       'expires_at', v_expires,
                                       'clinic_name', (select o.name from public.organizations o where o.id = p_org));
end;
$$;

-- -----------------------------------------------------------------------------
-- The onboarding line: the link's delivery and its latest invitation email (P4-490)
-- -----------------------------------------------------------------------------
-- *_professionals_onboarding.sql's states, three columns appended:
-- * delivery: `email` or `copied` (`email` for a link issued before this migration);
-- * email_status, email_error: for an emailed link, its latest `professionals.invite` or
--   `professionals.invite_reminder` email since the link was issued (email_log's status and error
--   code); without one, a null status and the failure the function stamped (null when none: the
--   send is still running, or the function never finished). Null for a copied link.
-- The client reads them (lib/onboarding.ts `invitationEmail`): never « envoyée » without an email.
drop function public.list_professional_invitation_states();
drop function private.professional_onboarding_states(uuid, uuid);

create function private.professional_onboarding_states(p_org uuid, p_id uuid)
returns table (
  professional_id uuid, state text, sent_at timestamptz, expires_at timestamptz, opened_at timestamptz,
  used_at timestamptz, submission_id uuid, submission_kind text, submission_status text,
  submitted_at timestamptz, onboarding_approved boolean,
  delivery text, email_status text, email_error text
)
language sql
stable
set search_path = ''
as $$
  with l as (
    select distinct on (x.subject_id) x.subject_id as pid, x.id, x.created_at, x.expires_at, x.last_opened_at,
           x.used_at, x.revoked_at, x.use_count
      from public.secure_links x
     where x.org_id = p_org and x.purpose = 'professional_invite' and x.subject_type = 'professional'
       and (p_id is null or x.subject_id = p_id)
     order by x.subject_id, (x.use_count > 0) desc, (x.revoked_at is null) desc, x.created_at desc, x.id desc
  ), s as (
    select x.professional_id as pid, x.id, x.kind, x.status, x.submitted_at
      from public.professional_submissions x
     where x.org_id = p_org and x.status in ('draft', 'submitted') and (p_id is null or x.professional_id = p_id)
  ), a as (
    select distinct x.professional_id as pid
      from public.professional_submissions x
     where x.org_id = p_org and x.kind = 'onboarding' and x.status = 'approved' and (p_id is null or x.professional_id = p_id)
  )
  select p.id,
         case when l.pid is null then null
              when l.use_count > 0 then 'used'
              when l.revoked_at is not null then 'revoked'
              when l.expires_at <= pg_catalog.now() then 'expired'
              when l.last_opened_at is not null then 'opened'
              else 'sent' end,
         l.created_at, l.expires_at, l.last_opened_at, l.used_at,
         s.id, s.kind, s.status, s.submitted_at, a.pid is not null,
         case when l.pid is not null then coalesce(d.method, 'email') end,
         case when l.pid is not null and d.method is distinct from 'copied' then e.status end,
         case when l.pid is not null and d.method is distinct from 'copied' then coalesce(e.error_code, case when e.id is null then d.email_failure end) end
    from public.professionals p
    left join l on l.pid = p.id
    left join public.professional_invitation_deliveries d on d.link_id = l.id
    left join lateral private.latest_subject_email(p_org, 'professional', p.id,
                array['professionals.invite', 'professionals.invite_reminder'], l.created_at) e on l.pid is not null
    left join s on s.pid = p.id
    left join a on a.pid = p.id
   where p.org_id = p_org and (p_id is null or p.id = p_id)
     and (l.pid is not null or s.pid is not null or a.pid is not null)
$$;
revoke all on function private.professional_onboarding_states(uuid, uuid) from public, anon, authenticated, service_role;

-- Same signature, checks and grants; the invitation carries delivery, email_status, email_error.
create or replace function public.get_professional_onboarding(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  return (
    select pg_catalog.jsonb_build_object(
             'invitation', case when s.state is not null then pg_catalog.jsonb_build_object(
                                  'state', s.state, 'sent_at', s.sent_at, 'expires_at', s.expires_at,
                                  'opened_at', s.opened_at, 'used_at', s.used_at, 'delivery', s.delivery,
                                  'email_status', s.email_status, 'email_error', s.email_error) end,
             'submission', case when s.submission_id is not null then pg_catalog.jsonb_build_object(
                                  'id', s.submission_id, 'kind', s.submission_kind, 'status', s.submission_status,
                                  'submitted_at', s.submitted_at) end,
             'onboarding_approved', s.onboarding_approved)
      from private.professional_onboarding_states(private.current_user_org_id(), p_id) s);
end;
$$;

-- « À surveiller » and P4-43 for the whole list, in one request (the three columns appended).
create function public.list_professional_invitation_states()
returns table (
  professional_id uuid, state text, sent_at timestamptz, expires_at timestamptz, opened_at timestamptz,
  used_at timestamptz, submission_id uuid, submission_kind text, submission_status text,
  submitted_at timestamptz, onboarding_approved boolean,
  delivery text, email_status text, email_error text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  return query select * from private.professional_onboarding_states(private.current_user_org_id(), null);
end;
$$;

-- -----------------------------------------------------------------------------
-- The history: a copied link is an event (« a copié le lien d'invitation »)
-- -----------------------------------------------------------------------------
create or replace function private.professional_history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['professionals', 'professional_public_profiles', 'professional_matching_profiles',
               'professional_matching_notes',
               'professional_professions', 'professional_clienteles',
               'professional_motifs', 'professional_languages', 'professional_payer_numbers',
               'professional_private', 'professional_retention', 'professional_session_counts',
               'professional_client_agreements', 'professional_submissions', 'professional_consents',
               'professional_documents', 'professional_invitation_deliveries']
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  public.copy_professional_invitation_link(uuid, uuid, bytea),
  public.record_professional_invitation_email_failure_for_service(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.copy_professional_invitation_link(uuid, uuid, bytea),
  public.record_professional_invitation_email_failure_for_service(uuid, uuid, text)
to service_role;

revoke all on function public.list_professional_invitation_states() from public, anon, authenticated, service_role;
grant execute on function public.list_professional_invitation_states() to authenticated;
