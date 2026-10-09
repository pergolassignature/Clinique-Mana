-- =============================================================================
-- Professionnels: the questionnaire's documents while it waits for review
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md (decision P4-495)
-- Needs:   *_professionals_onboarding.sql (professional_submissions, the staged files),
--          *_professionals_documents.sql (get_professional_documents)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The questionnaire's photo, insurance and image consent become documents only when the clinic
--   approves it (P4-400). Until then « Mes documents » and the Documents tab read « Manquant ».
--   get_professional_documents (same signature, same callers) adds `staged`: for each of those
--   types the open submission holds (draft or submitted, at most one), one item
--   { type_key, kind, submission_id, status, submitted_at }. The cards say « envoyé avec votre
--   questionnaire » / « dans le questionnaire à réviser » instead.
-- * An item counts only for a section the submission requests: a photo or an insurance whose
--   staged file is still ready, uploaded for that submission and within its staging; a consent
--   once signed. The provider sees only files she uploaded herself; staff with professionals.view
--   see them all. Nothing of the file (id, name, insurer, last day) nor the signer is returned:
--   the review sheet shows those to reviewers.
-- =============================================================================

-- The Documents tab and « Mes documents » in one payload: staff with professionals.view for any
-- professional of the clinic; the provider for their own record (p_id null = their own). Null
-- when the caller cannot read it. Newest first; `file` is null once the file is gone (rejected,
-- deleted); `reviewed_by_name` for staff only; `consent` is the latest e-consent, its
-- `signer_name` for staff only (P4-472: the provider never reads that table, P4-420, and a file
-- re-linked to another account would show the previous holder's name); `photo` the
-- public profile's photo (document and file ids, for storage-sign); `staged` what the open
-- questionnaire holds for photo, insurance and image_consent (P4-495). `today` is the clinic's
-- date (cards compare expires_on with it, never with the browser's).
create or replace function public.get_professional_documents(p_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_staff boolean := private.has_permission('professionals.view');
  v_own uuid := private.current_professional_id();
  v_pid uuid := coalesce(p_id, v_own);
  v_profile uuid;
begin
  if v_pid is null or v_org is null
     or not (v_staff or (v_pid = v_own and private.has_permission('professionals.self'))) then
    return null;
  end if;
  select p.profile_id into v_profile from public.professionals p where p.id = v_pid and p.org_id = v_org;
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'professional_id', v_pid,
    'today', private.clinic_today(),
    'photo', (
      select pg_catalog.jsonb_build_object('document_id', d.id, 'file_id', d.stored_file_id)
        from public.professional_public_profiles x
        join public.professional_documents d on d.professional_id = x.professional_id and d.id = x.photo_document_id
       where x.professional_id = v_pid and x.org_id = v_org),
    'documents', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', d.id, 'type_id', d.document_type_id, 'type_key', t.key, 'status', d.status,
               'expires_on', d.expires_on, 'metadata', d.metadata, 'uploaded_at', d.uploaded_at,
               'uploaded_by_self', d.uploaded_by is not null and d.uploaded_by is not distinct from v_profile,
               'reviewed_at', d.reviewed_at, 'reviewed_by_name', rv.display_name,
               'rejection_reason', d.rejection_reason, 'submission_id', d.submission_id,
               'file', case when f.id is not null then pg_catalog.jsonb_build_object(
                         'id', f.id, 'name', f.original_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes) end)
             order by d.created_at desc, d.id desc)
        from public.professional_documents d
        join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id
        left join public.stored_files f on f.id = d.stored_file_id and f.status = 'ready'
        left join public.profiles rv on v_staff and rv.user_id = d.reviewed_by and rv.org_id = v_org
       where d.professional_id = v_pid and d.org_id = v_org), '[]'::jsonb),
    'consent', (
      select pg_catalog.jsonb_build_object(
               'id', k.id, 'version', cv.version, 'signer_name', case when v_staff then k.signer_name end, 'signed_at', k.signed_at,
               'expires_on', k.expires_on, 'withdrawn_at', k.withdrawn_at, 'withdrawal_effective_on', k.withdrawal_effective_on)
        from public.professional_consents k
        join public.consent_versions cv on cv.org_id = k.org_id and cv.id = k.consent_version_id
       where k.professional_id = v_pid and k.org_id = v_org
       order by k.signed_at desc, k.id desc
       limit 1),
    'staged', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'type_key', x.type_key, 'kind', x.kind, 'submission_id', s.id, 'status', s.status,
               'submitted_at', s.submitted_at)
             order by x.ord)
        from public.professional_submissions s
       cross join lateral (values
               (1, 'photo', 'photo', s.submitted_values #>> '{photo,file_id}'),
               (2, 'insurance', 'insurance', s.submitted_values #>> '{insurance,file_id}'),
               (3, 'image_consent', 'consent', null)) as x(ord, type_key, kind, file_id)
       where s.professional_id = v_pid and s.org_id = v_org and s.status in ('draft', 'submitted')
         and x.kind = any (s.requested_sections)
         and case when x.kind = 'consent' then s.submitted_values #>> '{consent,consent_version_id}' is not null
                  else exists (
                    select 1 from public.stored_files f
                     where f.id = x.file_id::uuid and f.org_id = v_org and f.status = 'ready'
                       and f.purpose = 'professional_submission_file'
                       and f.subject_type = 'professional_submission' and f.subject_id = s.id
                       and (f.retain_until is null or f.retain_until > pg_catalog.now())
                       and (v_staff or f.uploaded_by = auth.uid())) end), '[]'::jsonb)
  );
end;
$$;
