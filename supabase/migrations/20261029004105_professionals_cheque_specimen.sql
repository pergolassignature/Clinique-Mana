-- =============================================================================
-- Professionnels: « Spécimen de chèque » as a document (P4-563)
-- =============================================================================
-- Jonathan, « Suivi - application » of 22 October 2026, on « Étape 10 sur 12 — Fiscalité et
-- banque »: « Ajouter une fonction pour ajouter le spécimen de chèque au lieu de l'inscrire pour
-- éviter les erreurs de frappe ».
-- Needs:   *_professionals_documents.sql (the document types and their seed).
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6.
--
-- Key choices
-- * **The three typed numbers stay** (Jonathan asked for the upload « au lieu de » typing them,
--   and the clinic chose to keep both). They remain the values a payment is made from, encrypted
--   with a key version (ADR 0004); the specimen is what staff check them against, which is what
--   kills the typos. Dropping them would have moved the account number out of its encrypted
--   column and into an image, read under the documents' permissions instead.
-- * **A document type, not a new questionnaire field.** `professional_submissions` forbids a
--   `tax_bank` key in `submitted_values` (the sensitive answers live in
--   `professional_submission_private` and are deleted once reviewed), so a file there could not
--   follow the insurance's path. As a document it reuses everything that already exists: the
--   accepted types and the size cap, the professional's own upload
--   (`professional_self_document`, `professionals.self`), the clinic's verification, « Mes
--   documents », the Documents tab and the retention rules.
-- * **Not required** and with no expiry: a professional who types her three numbers is done, and a
--   specimen does not go stale. « Documents requis » can still ask for it per clinic.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_cheque_specimen', true);

-- Latest body: 20261009000253_professionals_documents.sql. One more type; nothing else changes.
create or replace function private.seed_professionals_document_types(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_any constant text[] := array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
                                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_document_types', true);
  insert into public.document_types
    (org_id, key, name, is_system, required, expiry_rule, reminder_days, weekly_after_expiry, accepted_mime, max_bytes, sort_order)
  values
    (p_org, 'photo', 'Photo professionnelle', true, true, 'none', '{}', false, array['image/jpeg', 'image/png'], 5242880, 10),
    (p_org, 'insurance', 'Preuve d''assurance responsabilité', true, true, 'next_march_31', '{7}', true,
     array['application/pdf', 'image/jpeg', 'image/png'], 10485760, 20),
    (p_org, 'image_consent', 'Consentement droit à l''image', true, true, 'months_12', '{}', false,
     array['application/pdf', 'image/jpeg', 'image/png'], 10485760, 30),
    -- P4-563: what the three deposit numbers are checked against, so a typo is caught.
    (p_org, 'cheque_specimen', 'Spécimen de chèque', false, false, 'none', '{}', false,
     array['application/pdf', 'image/jpeg', 'image/png'], 10485760, 35),
    (p_org, 'cv', 'CV', false, false, 'none', '{}', false, v_any, 10485760, 40),
    (p_org, 'diploma', 'Diplôme', false, false, 'none', '{}', false, v_any, 10485760, 50),
    (p_org, 'licence_attestation', 'Attestation de permis', false, false, 'none', '{}', false, v_any, 10485760, 60),
    (p_org, 'other', 'Autre', false, false, 'none', '{}', false, v_any, 10485760, 70)
  on conflict do nothing;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

-- Every clinic that exists today (the trigger covers the ones created later).
do $do$
declare
  v_org uuid;
begin
  for v_org in select o.id from public.organizations o loop
    perform private.seed_professionals_document_types(v_org);
  end loop;
end
$do$;

select pg_catalog.set_config('app.audit_source', '', true);
