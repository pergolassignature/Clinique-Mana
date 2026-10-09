-- =============================================================================
-- Professionnels: the review sheet reads the image consent signed through Documenso
-- =============================================================================
-- Asked:   gap audit 2026-10-09 (docs/audit/2026-10-09-gap-audit.md, V4), decision P4-505
-- Needs:   *_professionals_onboarding.sql (get_submission_review), *_professionals_image_consent.sql
--          (the questionnaire's consent signed through Documenso, P4-487, and its document)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Since P4-487 the questionnaire's « Consentement » step signs the Documenso form: that writes a
--   signature request (purpose professionals.image_consent, then `signed`) and a verified
--   document, never professional_consents nor submitted_values.consent. get_submission_review
--   read only those two, so a reviewer read « Aucun consentement au dossier » / « Pas encore
--   signé ». Same signature and grants; only the consent field changes:
--   - `current` (on file): the newest of a signed Documenso request ({source: 'signature',
--     request_id, signed_at}: the professional's signature, else the completion) and a verified
--     paper consent ({source: 'document', uploaded_at}); no end date (P4-504);
--   - `submitted` (the step's answer): the Documenso signature made since the questionnaire
--     opened ({source: 'signature', request_id, signed_at}), else null;
--   - the retired e-consent (professional_consents, a draft's `consent` answer) is no longer read
--     (P4-507), so `answered` / `changed` are false (private.submission_available_fields never
--     offers the consent: it is on file once signed, nothing is applied).
-- =============================================================================

-- Per requested section, per field: {field, label_key, kind, answered, current, submitted, changed};
-- private fields only {field, label_key, kind, answered, changed} (never a value, P4-175). answered:
-- the field can be applied (its key was saved, P4-176); an unanswered field is never applied. Ids as the record gives
-- them (labels from the cached catalogue). Null for another clinic's or an unknown submission.
create or replace function public.get_submission_review(p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_sub public.professional_submissions;
  v_snapshot jsonb;
  v_available text[];
begin
  if not private.has_permission('professionals.review') then
    raise exception 'Permission refusée : professionals.review' using errcode = '42501';
  end if;
  select * into v_sub from public.professional_submissions s where s.id = p_submission_id and s.org_id = v_org;
  if not found then
    return null;
  end if;
  v_snapshot := private.professional_submission_snapshot(v_org, v_sub.professional_id);
  v_available := private.submission_available_fields(v_sub);

  return (
    with sp as (select pg_catalog.to_jsonb(x) as j from public.professional_submission_private x
                 where x.submission_id = v_sub.id and x.org_id = v_org),
    pp as (select pg_catalog.to_jsonb(x) as j from public.professional_private x
            where x.professional_id = v_sub.professional_id and x.org_id = v_org),
    -- The image consent's signatures through Documenso (P4-487): when the professional signed.
    signed as (
      select r.id, coalesce((select max(x.signed_at) from public.signature_request_signers x
                              where x.request_id = r.id and x.role = 'professional'), r.completed_at) as signed_at
        from public.signature_requests r
       where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = v_sub.professional_id
         and r.purpose = 'professionals.image_consent' and r.status = 'signed'),
    -- The consent on file (P4-507: the Documenso path only), the newest of: a signature through
    -- Documenso, a paper consent staff attached (verified). No end date (P4-504).
    consent_now as (
      select x.j
        from (select pg_catalog.jsonb_build_object('source', 'signature', 'request_id', signed.id, 'signed_at', signed.signed_at) as j,
                     signed.signed_at as at
                from signed
              union all
              select pg_catalog.jsonb_build_object('source', 'document', 'uploaded_at', d.uploaded_at), d.uploaded_at
                from public.professional_documents d
                join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id and t.key = 'image_consent'
               where d.professional_id = v_sub.professional_id and d.org_id = v_org and d.status = 'verified'
                 and d.signature_request_id is null) x
       order by x.at desc nulls last
       limit 1),
    -- Signed through Documenso since this questionnaire opened: the « Consentement » step's answer.
    consent_here as (
      select pg_catalog.jsonb_build_object('source', 'signature', 'request_id', signed.id, 'signed_at', signed.signed_at) as j
        from signed
       where signed.signed_at >= v_sub.created_at
       order by signed.signed_at desc
       limit 1),
    f as (
      select x.section, x.field, x.kind, x.ord,
             case x.kind
               when 'plain' then nullif(v_snapshot -> x.section -> x.field, 'null'::jsonb)
               when 'set' then v_snapshot -> x.section -> x.field
               when 'consent' then (select consent_now.j from consent_now)
             end as cur,
             case x.kind
               when 'plain' then nullif(v_sub.submitted_values -> x.section -> x.field, 'null'::jsonb)
               when 'set' then v_sub.submitted_values -> x.section -> x.field
               when 'file' then v_sub.submitted_values -> x.section
               -- is_latest: still the latest published text (apply refuses it otherwise, P4-305), so the
               -- sheet can say so before « Appliquer » (P4-378).
               -- P4-505, P4-507: the step's answer is her Documenso signature (a draft's old
               -- e-consent answer is no longer read).
               when 'consent' then (select consent_here.j from consent_here)
             end as sub,
             (x.field = any (v_available)) as available
        from private.submission_fields() x
       where x.section = any (v_sub.requested_sections))
    select pg_catalog.jsonb_build_object(
      'submission', pg_catalog.jsonb_build_object(
        'id', v_sub.id, 'professional_id', v_sub.professional_id, 'kind', v_sub.kind, 'status', v_sub.status,
        'requested_sections', v_sub.requested_sections, 'submitted_at', v_sub.submitted_at,
        'reviewed_at', v_sub.reviewed_at,
        'reviewed_by_name', (select pr.display_name from public.profiles pr where pr.user_id = v_sub.reviewed_by and pr.org_id = v_org),
        'decision_note', v_sub.decision_note, 'applied_fields', v_sub.applied_fields,
        'private_saved_at', v_sub.private_saved_at),
      'sections', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('section', g.section, 'fields', g.fields) order by g.ord)
          from (select f.section, min(f.ord) as ord,
                       pg_catalog.jsonb_agg(
                         case when f.kind = 'private' then
                           pg_catalog.jsonb_build_object(
                             'field', f.field, 'label_key', 'modules.professionals.submission.fields.' || f.field, 'kind', f.kind,
                             'answered', f.available,
                             'changed', f.available and (f.field in ('bank_account', 'sin')
                                                         or (select sp.j -> f.field from sp) is distinct from (select pp.j -> f.field from pp)))
                         else
                           pg_catalog.jsonb_build_object(
                             'field', f.field, 'label_key', 'modules.professionals.submission.fields.' || f.field, 'kind', f.kind,
                             'answered', f.available, 'current', f.cur, 'submitted', f.sub,
                             'changed', f.available and case f.kind
                               when 'file' then true
                               when 'consent' then true
                               when 'set' then case when f.field = 'professions'
                                                    then private.canonical_professions(f.cur) is distinct from private.canonical_professions(f.sub)
                                                    else f.cur is distinct from f.sub end
                               else f.cur is distinct from f.sub end)
                         end order by f.ord) as fields
                  from f
                 group by f.section) g), '[]'))
  );
end;
$$;
