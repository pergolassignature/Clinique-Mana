-- =============================================================================
-- Professionnels: the insurance expiry job (expired documents, staff notices, emails to send)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Tasks 4c.1 and 4c.4 (P4-1, P4-45,
--          P4-50; decisions P4-402, P4-403, P4-407 … P4-410)
-- Needs:   *_professionals_documents.sql (document types, documents, the insurance state, the
--          templates, private.expire_notifications), Phase 3 jobs and notifications
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Job `professionals.insurance_expiry_notice` (function professionals-insurance-expiry): a
--   business job at 06:00 clinic time (local_hour 6, P4-45), off by default like every business
--   job (« Tâches planifiées » switches it on), scheduled hourly; list_job_orgs / start_job_run pick
--   each clinic once per local day (P3-22). Safe for a quiet clinic: a day with nothing due
--   changes nothing and sends nothing.
-- * One service RPC per clinic and run, run_professionals_document_notices_for_service, does all
--   the database work in one transaction, in a few set-based statements (no query per
--   professional for the reads):
--   1. every verified document past its last valid day becomes `expired` (every type with a rule);
--      a photo that expired leaves the public profile;
--   2. the staff notices (P4-403, SQL, private.notify; addressed by professionals.manage,
--      important, 60 days, dedupe per document and date): for each **active** professional whose
--      latest insurance is due (private.professional_insurance_state, one statement):
--      `professionals.insurance_expiring` « Assurance bientôt échue » from the largest reminder day
--      (J-7 by default) to the last day, then `professionals.insurance_expired` « Assurance
--      expirée » (the professional stays active, P4-1). Each run also closes that professional's
--      older insurance notices (a corrected date raised a new key);
--   3. `professionals.documents_missing` (normal, professionals.manage, no name: a count, one per
--      clinic and ISO week, 7 days; closed when the count is back to zero): active professionals
--      whose required documents are not all in order (readiness `documents`, P4-407);
--   4. the emails to send, returned (the function sends them, P4-50): to each due active
--      professional without a newer insurance waiting for review (P4-408), at most one per step,
--      deduplicated against email_log (sent, queued or of unknown outcome; a plain failure is
--      tried again the next day): `professionals.document_expiring` once per reminder step
--      (since the step's first day), `professionals.document_expired` once after the last day,
--      then `professionals.document_expired_reminder` every 7 clinic days while the type says
--      weekly_after_expiry. So a manual « Exécuter maintenant » or a second run the same day sends
--      nothing twice, and a missed day catches up the next.
--   It returns counts and the emails' recipients (ids, address, first name, template, last day):
--   the function logs counts only (P4-410).
-- * Only `active` professionals are reminded: an inactive file is not chased (P4-11), and a file
--   not yet active shows its gaps in readiness.
-- * Audit: the expiries are written with source `job:professionals.insurance_expiry_notice`, no
--   actor. Service role only.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_insurance_expiry_job', true);

-- -----------------------------------------------------------------------------
-- Job catalogue row and schedule (P4-45: 06:00 clinic time, hourly cron, once per local day)
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, cron_job_name, local_hour, is_maintenance)
values
  ('professionals.insurance_expiry_notice', 'professionals', 'Échéances des assurances',
   'Marque les documents échus, avertit l''équipe des assurances qui arrivent à échéance ou sont échues et des documents requis manquants, et envoie les rappels aux professionnels.',
   'function', 'professionals-insurance-expiry', 'professionals.insurance_expiry_notice', 6, false)
on conflict do nothing;

select cron.schedule('professionals.insurance_expiry_notice', '15 * * * *',
  $$select private.invoke_job_function('professionals.insurance_expiry_notice')$$);

-- -----------------------------------------------------------------------------
-- The run (service role; see the header)
-- -----------------------------------------------------------------------------
-- {today, clinic_name, marked, expiring, expired, missing, emails: [{document_id, professional_id,
-- profile_id, email, first_name, template_key, expires_on}]} for p_org on p_today (default: the
-- clinic's today; tests pass a date). At most 500 emails, by professional id. P0001 HINT
-- module_disabled when the module is off for the clinic (start_job_run already refuses it).
create function public.run_professionals_document_notices_for_service(p_org uuid, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_clinic text;
  v_today date;
  v_marked int;
  v_expiring int := 0;
  v_expired int := 0;
  v_missing int;
  v_emails jsonb;
  r record;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_org is null then
    raise exception 'Organisation manquante' using errcode = '22023';
  end if;
  select o.timezone, o.name into v_tz, v_clinic from public.organizations o where o.id = p_org;
  if not found then
    raise exception 'Organisation inconnue' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org, 'professionals') then
    raise exception 'Le module Professionnels est désactivé pour cette clinique.' using errcode = 'P0001', hint = 'module_disabled';
  end if;
  v_today := coalesce(p_today, (pg_catalog.now() at time zone v_tz)::date);
  perform pg_catalog.set_config('app.audit_source', 'job:professionals.insurance_expiry_notice', true);
  perform pg_catalog.set_config('app.audit_actor', '', true);

  -- 1. Past their last valid day.
  update public.professional_documents d
     set status = 'expired'
   where d.org_id = p_org and d.status = 'verified' and d.expires_on < v_today;
  get diagnostics v_marked = row_count;
  update public.professional_public_profiles x
     set photo_document_id = (
           select d.id from public.professional_documents d
             join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id and t.key = 'photo'
            where d.professional_id = x.professional_id and d.org_id = p_org and d.status = 'verified'
            order by d.reviewed_at desc nulls last, d.created_at desc, d.id desc
            limit 1)
   where x.org_id = p_org and x.photo_document_id is not null
     and exists (select 1 from public.professional_documents d
                  where d.professional_id = x.professional_id and d.id = x.photo_document_id and d.status <> 'verified');

  -- 2. The insurance notices of active professionals.
  for r in
    select s.professional_id, s.expires_on, s.state, s.dedupe_key, p.first_name, p.last_name
      from private.professional_insurance_state(p_org, v_today, null) s
      join public.professionals p on p.id = s.professional_id and p.org_id = p_org and p.status = 'active'
     where s.state is not null
     order by s.professional_id
  loop
    perform private.expire_notifications(p_org, 'professional', r.professional_id,
      array['professionals.insurance_expiring', 'professionals.insurance_expired'], array[r.dedupe_key]);
    if r.state = 'expiring' then
      perform private.notify(
        p_org, 'professionals', 'professionals.insurance_expiring', 'important', 'Assurance bientôt échue',
        'L''assurance de ' || r.first_name || ' ' || r.last_name || ' prend fin le ' || private.format_date_fr(r.expires_on) || '.',
        '/professionnels/' || r.professional_id || '/documents', 'professional', r.professional_id,
        'professionals.manage', null, r.dedupe_key, pg_catalog.now() + interval '60 days');
      v_expiring := v_expiring + 1;
    else
      perform private.notify(
        p_org, 'professionals', 'professionals.insurance_expired', 'important', 'Assurance expirée',
        'L''assurance de ' || r.first_name || ' ' || r.last_name || ' a pris fin le ' || private.format_date_fr(r.expires_on)
          || '. Son dossier reste actif.',
        '/professionnels/' || r.professional_id || '/documents', 'professional', r.professional_id,
        'professionals.manage', null, r.dedupe_key, pg_catalog.now() + interval '60 days');
      v_expired := v_expired + 1;
    end if;
  end loop;

  -- 3. Active professionals whose required documents are not all in order (a count, no name).
  select count(*)::int into v_missing
    from public.professionals_readiness rd
    join public.professionals p on p.id = rd.professional_id and p.org_id = p_org and p.status = 'active'
   where rd.org_id = p_org and not rd.documents_ok;
  if v_missing > 0 then
    perform private.notify(
      p_org, 'professionals', 'professionals.documents_missing', 'normal', 'Documents requis manquants',
      case when v_missing = 1 then '1 professionnel actif n''a pas tous ses documents requis.'
           else v_missing || ' professionnels actifs n''ont pas tous leurs documents requis.' end,
      '/professionnels', 'organization', p_org, 'professionals.manage', null,
      'documents_missing:' || pg_catalog.to_char(v_today, 'IYYY-"W"IW'), pg_catalog.now() + interval '7 days');
  else
    perform private.expire_notifications(p_org, 'organization', p_org, array['professionals.documents_missing']);
  end if;

  -- 4. The emails due today (one statement).
  with due as (
    select s.professional_id, s.document_id, s.expires_on, s.state, s.step_start, s.weekly_after_expiry,
           p.first_name, p.email, p.profile_id
      from private.professional_insurance_state(p_org, v_today, null) s
      join public.professionals p on p.id = s.professional_id and p.org_id = p_org and p.status = 'active'
     where s.state is not null and not s.has_pending
  ),
  mail as (
    select e.subject_id as professional_id,
           max((e.created_at at time zone v_tz)::date) filter (where e.template_key = 'professionals.document_expiring') as last_expiring,
           max((e.created_at at time zone v_tz)::date) filter (where e.template_key = 'professionals.document_expired') as last_expired,
           max((e.created_at at time zone v_tz)::date)
             filter (where e.template_key in ('professionals.document_expired', 'professionals.document_expired_reminder'))
             as last_any_expired
      from public.email_log e
     where e.org_id = p_org and e.subject_type = 'professional'
       and e.subject_id in (select due.professional_id from due)
       and e.template_key in ('professionals.document_expiring', 'professionals.document_expired',
                              'professionals.document_expired_reminder')
       and (e.status <> 'failed' or e.error_code = 'provider_unavailable')
       and e.created_at > pg_catalog.now() - interval '400 days'
     group by e.subject_id
  ),
  pick as (
    select d.*,
           case
             when d.state = 'expiring' then
               case when m.last_expiring is null or m.last_expiring < d.step_start then 'professionals.document_expiring' end
             when m.last_expired is null or m.last_expired <= d.expires_on then 'professionals.document_expired'
             when d.weekly_after_expiry and m.last_any_expired <= v_today - 7 then 'professionals.document_expired_reminder'
           end as template_key
      from due d
      left join mail m on m.professional_id = d.professional_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'document_id', x.document_id, 'professional_id', x.professional_id, 'profile_id', x.profile_id,
           'email', x.email, 'first_name', x.first_name, 'template_key', x.template_key, 'expires_on', x.expires_on)
           order by x.professional_id), '[]'::jsonb)
    into v_emails
    from (select * from pick where pick.template_key is not null order by pick.professional_id limit 500) x;

  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object(
    'today', v_today, 'clinic_name', v_clinic, 'marked', v_marked, 'expiring', v_expiring, 'expired', v_expired,
    'missing', v_missing, 'emails', v_emails);
end;
$$;

revoke all on function public.run_professionals_document_notices_for_service(uuid, date) from public, anon, authenticated;
grant execute on function public.run_professionals_document_notices_for_service(uuid, date) to service_role;

select pg_catalog.set_config('app.audit_source', '', true);
