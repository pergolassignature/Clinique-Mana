-- Professionnels: the record's readiness carries the insurance's state (QA before the demo).
--
-- « À surveiller » (the list column, its filter and Aperçu) flags an insurance that expires soon or
-- has expired (« Assurance expire le … », « Assurance expirée depuis le … »). The list already reads
-- `professionals_list.insurance_status` / `insurance_expires_on` (4c.2, P4-406); Aperçu reads the
-- record bundle, whose `readiness` (get_professional_readiness) did not have them. It gains
-- `insurance: { status, expires_on }` from the same `professionals_readiness` columns: `status` is
-- valid / expiring / expired / missing, `expires_on` the last valid day (a date) or null.
-- Same body as *_professionals_contracts.sql otherwise; additive (a new key).

create or replace function public.get_professional_readiness(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'complete', r.ready,
           'done', r.matching_complete::int + r.account_created::int + r.submission_approved::int + r.documents_ok::int
                   + r.contract_signed::int,
           'total', 5,
           'items', pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'key', 'matching_profile',
               'done', r.matching_complete,
               'missing', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
                 case when not r.has_profession then 'profession' end,
                 case when not r.licences_ok then 'licence' end,
                 case when not r.restricted_motifs_ok then 'regulated_title' end,
                 case when not r.has_language then 'language' end,
                 case when not r.has_clientele then 'clientele' end,
                 case when not r.has_motif then 'motif' end], null))),
             pg_catalog.jsonb_build_object('key', 'account_created', 'done', r.account_created, 'missing', '[]'::jsonb),
             pg_catalog.jsonb_build_object('key', 'submission_approved', 'done', r.submission_approved, 'missing', '[]'::jsonb),
             pg_catalog.jsonb_build_object('key', 'documents', 'done', r.documents_ok,
                                           'missing', pg_catalog.to_jsonb(r.documents_missing)),
             pg_catalog.jsonb_build_object('key', 'contract_signed', 'done', r.contract_signed, 'missing', '[]'::jsonb)),
           'warnings', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
             case when not r.email_matches_login then 'login_email_mismatch' end], null)),
           'insurance', pg_catalog.jsonb_build_object(
             'status', coalesce(r.insurance_status, 'missing'),
             'expires_on', r.insurance_expires_on))
    from public.professionals_readiness r
   where r.professional_id = p_id
$$;
