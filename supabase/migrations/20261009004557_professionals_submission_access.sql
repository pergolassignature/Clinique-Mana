-- =============================================================================
-- Professionnels: who reads a submission's answers, closing an update, staged files (Task 4b.7)
-- =============================================================================
-- Needs:   *_professionals_onboarding.sql (4b.1: professional_submissions, professional_consents,
--          submit_my_submission, cancel_open_submission, the professional_submission_file purpose)
-- Review of the whole 4b diff (P4-420 – P4-422, « déléguée — révisable »):
--
-- * P4-420: the answers of a submission (prefill, submitted_values, decision_note) are read only
--   through the definer RPCs (get_my_submission for the provider, get_submission_review with
--   professionals.review for staff). Table reads keep the columns without answers: a staff member
--   with professionals.view only (the conseillère) sees that a questionnaire exists and its state,
--   never its contents; the provider's own policy now gives the same columns (her readiness reads
--   « Questionnaire approuvé » through professionals_readiness), so a newly linked account never
--   reads the answers of the person who held the file before. The provider's policy on
--   professional_consents is dropped: the signer's name is the previous holder's too (the app
--   never read that table as the provider).
-- * P4-421: « Fermer la demande » (cancel_professional_submission, professionals.invite) closes an
--   open UPDATE (draft or sent) without applying it, so a forgotten or mistaken update no longer
--   blocks every later request (« Une soumission est déjà en cours. »). An onboarding questionnaire
--   is never closed this way: « Questionnaire approuvé » needs it (revoke the invitation, or send
--   the profile back, instead).
-- * P4-422: sending the profile keeps its staged photo and insurance 90 days from the sending (the
--   upload purpose keeps them 60 days from the upload), so a slow review does not find them purged.
--   A resubmission clears the previous return's reviewer and date (it waits for review again).

select pg_catalog.set_config('app.audit_source', 'migration:professionals_submission_access', true);

-- -----------------------------------------------------------------------------
-- P4-420: no answers through table reads
-- -----------------------------------------------------------------------------
revoke select on public.professional_submissions from authenticated;
grant select (id, org_id, professional_id, kind, status, requested_sections, secure_link_id, requested_by,
              private_saved_at, submitted_at, reviewed_at, reviewed_by, applied_fields, created_at, updated_at)
  on public.professional_submissions to authenticated;

drop policy professional_consents_select_self on public.professional_consents;

-- -----------------------------------------------------------------------------
-- P4-421: « Fermer la demande » of an update
-- -----------------------------------------------------------------------------
-- Closes an open update submission (draft or sent) of the caller's clinic without applying it:
-- status `cancelled`, its private row deleted (private.cancel_open_submission). Locks the
-- professional, then the submission (the order of every submission write). Refused for an
-- onboarding questionnaire and for a submission no longer open.
create function public.cancel_professional_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
  v_sub public.professional_submissions;
begin
  if not private.has_permission('professionals.invite') then
    raise exception 'Permission refusée : professionals.invite' using errcode = '42501';
  end if;
  select s.professional_id into v_pid from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org;
  if not found then
    raise exception 'Soumission introuvable.' using errcode = 'P0001';
  end if;
  perform private.lock_professional(v_pid);
  select * into v_sub from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org and s.professional_id = v_pid
     for update;
  if v_sub.kind <> 'update' then
    raise exception 'Le questionnaire d''accueil ne se ferme pas : révoquez l''invitation ou renvoyez le profil au professionnel.'
      using errcode = 'P0001', hint = 'kind';
  end if;
  if v_sub.status not in ('draft', 'submitted') then
    raise exception 'Cette mise à jour est déjà fermée ou appliquée.' using errcode = 'P0001', hint = 'status';
  end if;
  perform private.cancel_open_submission(v_org, v_pid);
end;
$$;

revoke all on function public.cancel_professional_submission(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_professional_submission(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- P4-422: « Envoyer mon profil » keeps the staged files for the review
-- -----------------------------------------------------------------------------
-- As 4b.1's, plus: the staged photo and insurance named by the answers are kept at least 90 days
-- from now (never shortened), and the previous return's reviewer and date are cleared.
create or replace function public.submit_my_submission()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
  v_sub public.professional_submissions;
  v_row public.professionals;
  v_gaps text[];
  v_now timestamptz := pg_catalog.now();
begin
  v_pid := private.my_professional_id();
  perform private.lock_active_professional(v_pid, true);
  v_sub := private.lock_my_draft(v_org, v_pid);
  v_gaps := private.submission_gaps(v_sub);
  if pg_catalog.cardinality(v_gaps) > 0 then
    raise exception 'Certaines sections sont incomplètes.' using errcode = 'P0001', hint = 'sections',
      detail = pg_catalog.array_to_string(v_gaps, ',');
  end if;
  perform private.dry_run_submission_sets(v_org, v_pid, v_sub.submitted_values, v_sub.requested_sections);

  update public.professional_submissions s
     set status = 'submitted', submitted_at = v_now, decision_note = null, reviewed_at = null, reviewed_by = null
   where s.id = v_sub.id and s.org_id = v_org;

  update public.stored_files f
     set retain_until = v_now + interval '90 days'
   where f.org_id = v_org and f.purpose = 'professional_submission_file'
     and f.subject_type = 'professional_submission' and f.subject_id = v_sub.id
     and f.status = 'ready' and f.retain_until is not null and f.retain_until < v_now + interval '90 days'
     and f.id in (select (v_sub.submitted_values #>> '{photo,file_id}')::uuid
                  union all
                  select (v_sub.submitted_values #>> '{insurance,file_id}')::uuid);

  select * into v_row from public.professionals p where p.id = v_pid and p.org_id = v_org;
  if v_sub.kind = 'onboarding' and v_row.status in ('draft', 'invited') then
    update public.professionals p
       set status = 'in_review', status_changed_at = v_now, status_changed_by = auth.uid()
     where p.id = v_pid and p.org_id = v_org;
  end if;

  -- One notice per sending (a resubmission after a refusal notifies again, P4-271): the key holds the
  -- clock time, not the transaction's, so two sendings never share it.
  perform private.notify(
    v_org, 'professionals', 'professionals.submission_received', 'normal',
    case v_sub.kind when 'onboarding' then 'Profil à réviser' else 'Mise à jour à réviser' end,
    v_row.first_name || ' ' || v_row.last_name
      || case v_sub.kind when 'onboarding' then ' a envoyé son profil.' else ' a envoyé une mise à jour de son profil.' end,
    '/professionnels/' || v_pid || '/documents', 'professional', v_pid, 'professionals.review', null,
    'submission:' || v_sub.id || ':' || pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), null);
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
