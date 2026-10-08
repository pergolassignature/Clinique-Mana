-- =============================================================================
-- Professionnels: what the onboarding edge functions need (reminder job, re-issue, submission notice)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4b.2 (P4-45, P4-260 … P4-267)
-- Needs:   *_professionals_onboarding.sql (4b.1: the professional_invite purpose, the onboarding
--          submissions, the settings invitation_expiry_days / invitation_reminder_after_days, the
--          template professionals.invite_reminder), Phase 3 jobs, secure links and email_log
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Job `professionals.invitation_reminders` (function professionals-invitation-reminders): a
--   business job at 08:00 clinic time (local_hour 8, P4-45), off by default like every business job
--   (« Tâches planifiées » switches it on), scheduled hourly; list_job_orgs / start_job_run pick each
--   clinic once per local day (P3-22).
-- * Which invitations get a reminder (private.professional_invitations_due_for_reminder, one rule
--   for the list and the re-issue): the clinic's reminder delay is set (not null); the file has no
--   account and is not inactive; its live professional_invite link (one per file) is unexpired,
--   never opened and older than the delay; no professionals.invite_reminder email was logged for
--   the file since that link was made (so one reminder per staff sending: the reminder's own link
--   is older than its email, and a later « Renvoyer » starts the count again); and the link's
--   inviter (created_by) still holds professionals.invite as an active member of the clinic,
--   because link_professional_account re-checks exactly that (P3-31) and would answer
--   link_invalid: a reminder whose link cannot be accepted is not sent (P4-263).
-- * reissue_professional_invitation_for_service issues the new link for the system (service role,
--   no person acting): professional lock first, the rule re-checked under it (null when the file no
--   longer qualifies), then private.issue_professional_invitation_link (4b.1, P4-300), the one
--   issuer of professional_invite links: the original inviter as created_by (the acceptance
--   re-checks her), the clinic's current invitation_expiry_days, and the file's address bound in
--   the scope, without which the acceptance refuses the link; then the onboarding draft re-pointed
--   to the new link, as create_professional_invitation does. The previous link is revoked by the
--   issue (one live link per file); its raw token is gone, so a reminder is always a new link. A
--   corrected address revokes the live link (set_professional_email, P4-300), so a reminded link
--   is never sent to an address the file no longer has. Audit source
--   `job:professionals.invitation_reminders`, no actor.
-- * get_professional_submission_notice_for_service(p_actor): what professionals-submit emails after
--   submit_my_submission succeeded (the in-app notice is already created there, P4-271): the
--   caller's submitted submission (one open per file), the professional's name, and up to 20 active
--   members of the clinic holding professionals.review (private.permission_keys_for: role defaults,
--   overrides and the module switch), the actor excluded. p_actor is the user the function verified
--   (never a body value); the org is the actor's. Null when the actor has no submitted submission.
-- * Service role only for all three; no client privilege. Nothing here changes a 4b.1 RPC.
-- * 4b.1's security review (P4-300 … P4-308) as it bears on these: the re-issue binds the address
--   (above); an inactive file is never due (the rule) and its open submission is `cancelled`, which
--   the notice never reads (submitted only, P4-301); the provider RPCs refuse an inactive file
--   before submit_my_submission succeeds (P4-303), so no notice follows.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_onboarding_functions', true);

-- -----------------------------------------------------------------------------
-- Job catalogue row and schedule (P4-45: 08:00 clinic time, hourly cron, once per local day)
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, cron_job_name, local_hour, is_maintenance)
values
  ('professionals.invitation_reminders', 'professionals', 'Rappels d''invitation',
   'Envoie un rappel, avec un nouveau lien, aux professionnels qui n''ont pas ouvert leur invitation après le délai choisi dans les réglages « Invitations ».',
   'function', 'professionals-invitation-reminders', 'professionals.invitation_reminders', 8, false)
on conflict do nothing;

select cron.schedule('professionals.invitation_reminders', '5 * * * *',
  $$select private.invoke_job_function('professionals.invitation_reminders')$$);

-- -----------------------------------------------------------------------------
-- The reminder rule (one place for the list and the re-issue)
-- -----------------------------------------------------------------------------
-- The files of p_org (one file when p_id is given) whose invitation is due for a reminder now, with
-- their live link and its inviter; oldest link first, at most p_limit.
create function private.professional_invitations_due_for_reminder(p_org uuid, p_id uuid, p_limit int)
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
     and exists (select 1 from public.profiles pr
                  where pr.user_id = l.created_by and pr.org_id = p_org and pr.status = 'active')
     and 'professionals.invite' = any (private.permission_keys_for(l.created_by))
   order by l.created_at, l.id
   limit greatest(least(coalesce(p_limit, 100), 500), 1)
$$;
revoke all on function private.professional_invitations_due_for_reminder(uuid, uuid, int)
  from public, anon, authenticated, service_role;

-- The job's list: the files of p_org due for a reminder (at most p_limit, 1–500, default 100).
create function public.list_professional_invitations_to_remind_for_service(p_org uuid, p_limit int default 100)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null then
    raise exception 'Organisation manquante' using errcode = '22023';
  end if;
  return query select r.professional_id from private.professional_invitations_due_for_reminder(p_org, null, p_limit) r;
end;
$$;

-- A new link for a file still due for a reminder, issued for the system: {link_id, email,
-- first_name, expires_at, clinic_name} (what the email needs), or null when the file no longer
-- qualifies (opened, accepted, revoked, reminded, inactive, inviter without professionals.invite,
-- reminders switched off…).
create function public.reissue_professional_invitation_for_service(p_org uuid, p_id uuid, p_token_hash bytea)
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
-- The submission email (professionals-submit, after submit_my_submission)
-- -----------------------------------------------------------------------------
-- {org_id, professional_id, submission_id, kind, full_name, reviewers: [{user_id, email}]} for the
-- actor's submitted submission; null when there is none. At most 20 reviewers, by user id.
create function public.get_professional_submission_notice_for_service(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_row public.professionals;
  v_sub public.professional_submissions;
begin
  if p_actor is null then
    raise exception 'Acteur manquant' using errcode = '22023';
  end if;
  select p.org_id into v_org from public.profiles p where p.user_id = p_actor and p.status = 'active';
  if v_org is null then
    return null;
  end if;
  select * into v_row from public.professionals p where p.profile_id = p_actor and p.org_id = v_org;
  if not found then
    return null;
  end if;
  select * into v_sub from public.professional_submissions s
   where s.professional_id = v_row.id and s.org_id = v_org and s.status = 'submitted'
   order by s.submitted_at desc, s.id desc
   limit 1;
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'org_id', v_org,
    'professional_id', v_row.id,
    'submission_id', v_sub.id,
    'kind', v_sub.kind,
    'full_name', pg_catalog.rtrim(pg_catalog.left(v_row.first_name || ' ' || v_row.last_name, 160)),
    'reviewers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user_id', r.user_id, 'email', r.email) order by r.user_id)
        from (select pr.user_id, pr.email
                from public.profiles pr
               where pr.org_id = v_org and pr.status = 'active' and pr.user_id <> p_actor
                 and 'professionals.review' = any (private.permission_keys_for(pr.user_id))
               order by pr.user_id
               limit 20) r), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: service role only (the edge functions)
-- -----------------------------------------------------------------------------
revoke all on function
  public.list_professional_invitations_to_remind_for_service(uuid, int),
  public.reissue_professional_invitation_for_service(uuid, uuid, bytea),
  public.get_professional_submission_notice_for_service(uuid)
from public, anon, authenticated;
grant execute on function
  public.list_professional_invitations_to_remind_for_service(uuid, int),
  public.reissue_professional_invitation_for_service(uuid, uuid, bytea),
  public.get_professional_submission_notice_for_service(uuid)
to service_role;

select pg_catalog.set_config('app.audit_source', '', true);
