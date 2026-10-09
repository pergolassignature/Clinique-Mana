-- =============================================================================
-- Professionnels: one rule for an insurance's dates (its last valid day)
-- =============================================================================
-- Asked:   gap audit 2026-10-09 (docs/audit/2026-10-09-gap-audit.md, V12), decision P4-511
-- Needs:   *_professionals_insurance_reminders_questionnaire.sql (run_professionals_document_notices_for_service),
--          *_professionals_documents.sql (the three insurance email templates)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * `expires_on` is the last valid day (P4-2). The app says it everywhere as P4-456 chose for the
--   Documents tab: « valide jusqu'au {dernier jour} » (« Expire bientôt : valide jusqu'au … »,
--   « Expiré : valide jusqu'au … »), never « depuis le {lendemain} » nor « échue depuis le {dernier
--   jour} », which disagreed by a day. The staff notices and the professional's emails said « prend
--   fin le » / « a pris fin le » the same day; they now say « est valide jusqu'au » / « était valide
--   jusqu'au ».
-- * The notices: run_professionals_document_notices_for_service, its latest definition with only
--   those two sentences changed (same signature, same privileges).
-- * The emails: the defaults of `professionals.document_expiring`, `.document_expired` and
--   `.document_expired_reminder`, by replacing those words only (a clinic's own copy in
--   email_templates is its text: left as it is). Idempotent.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_insurance_dates_wording', true);

-- -----------------------------------------------------------------------------
-- The staff notices (*_professionals_insurance_reminders_questionnaire.sql's run)
-- -----------------------------------------------------------------------------
-- {today, clinic_name, marked, expiring, expired, missing, emails: [{document_id, professional_id,
-- profile_id, email, first_name, template_key, expires_on}]} for p_org on p_today (default: the
-- clinic's today; tests pass a date). At most 500 emails, by professional id. P0001 HINT
-- module_disabled when the module is off for the clinic (start_job_run already refuses it). No
-- email while a newer insurance waits for review: a document (P4-408) or a questionnaire sent to
-- the clinic (P4-496).
create or replace function public.run_professionals_document_notices_for_service(p_org uuid, p_today date default null)
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

  -- 2. The insurance notices of active professionals. A file no longer active is not chased
  -- (P4-408): its open insurance notices close.
  update public.notifications n
     set expires_at = pg_catalog.now()
   where n.org_id = p_org and n.subject_type = 'professional'
     and n.kind in ('professionals.insurance_expiring', 'professionals.insurance_expired')
     and (n.expires_at is null or n.expires_at > pg_catalog.now())
     and exists (select 1 from public.professionals p
                  where p.id = n.subject_id and p.org_id = p_org and p.status <> 'active');
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
        'L''assurance de ' || r.first_name || ' ' || r.last_name || ' est valide jusqu''au ' || private.format_date_fr(r.expires_on) || '.',
        '/professionnels/' || r.professional_id || '/documents', 'professional', r.professional_id,
        'professionals.manage', null, r.dedupe_key, pg_catalog.now() + interval '60 days');
      v_expiring := v_expiring + 1;
    else
      perform private.notify(
        p_org, 'professionals', 'professionals.insurance_expired', 'important', 'Assurance expirée',
        'L''assurance de ' || r.first_name || ' ' || r.last_name || ' était valide jusqu''au ' || private.format_date_fr(r.expires_on)
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
       -- P4-496: nor while a questionnaire sent to the clinic holds a new insurance still in force.
       and not exists (
         select 1
           from public.professional_submissions q
           join public.stored_files f
             on f.id = (q.submitted_values #>> '{insurance,file_id}')::uuid and f.org_id = q.org_id
            and f.status = 'ready' and f.purpose = 'professional_submission_file'
            and f.subject_type = 'professional_submission' and f.subject_id = q.id
            and (f.retain_until is null or f.retain_until > pg_catalog.now())
          where q.org_id = p_org and q.professional_id = s.professional_id and q.status = 'submitted'
            and 'insurance' = any (q.requested_sections)
            and (q.submitted_values #>> '{insurance,expires_on}')::date >= v_today)
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

-- -----------------------------------------------------------------------------
-- The professional's emails (defaults)
-- -----------------------------------------------------------------------------
update public.email_template_defaults d
   set subject = pg_catalog.replace(d.subject, 'Votre assurance prend fin le {{document.expires_on}}',
                                   'Votre assurance est valide jusqu''au {{document.expires_on}}'),
       body = pg_catalog.replace(pg_catalog.replace(d.body,
                'prend fin le {{document.expires_on}}', 'est valide jusqu''au {{document.expires_on}}'),
                'a pris fin le {{document.expires_on}}', 'était valide jusqu''au {{document.expires_on}}'),
       updated_at = pg_catalog.now()
 where d.key in ('professionals.document_expiring', 'professionals.document_expired', 'professionals.document_expired_reminder')
   and (d.subject like '%prend fin le {{document.expires_on}}%'
        or d.body like '%prend fin le {{document.expires_on}}%' or d.body like '%a pris fin le {{document.expires_on}}%');

select pg_catalog.set_config('app.audit_source', '', true);
