-- Migration: anon_document_upload_policies
-- Module: professionals
-- Gate: 3 — Security (RLS)
-- Created: 2026-01-19
--
-- Adds RLS policies allowing anon users to upload documents during onboarding.
-- Constraint: Only allowed if a valid, non-expired invite exists for the professional.

-- =============================================================================
-- PROFESSIONAL_DOCUMENTS: ANON INSERT POLICY
-- Allows anon to upload documents for professionals with valid invites
-- =============================================================================

drop policy if exists "professional_documents_insert_anon" on public.professional_documents;
create policy "professional_documents_insert_anon"
  on public.professional_documents
  for insert
  to anon
  with check (
    -- Only allow if there's a valid, non-expired invite for this professional
    exists (
      select 1 from public.professional_onboarding_invites
      where professional_id = professional_documents.professional_id
        and status in ('pending', 'opened')
        and expires_at > now()
    )
    -- Only allow specific document types during onboarding
    and document_type in ('photo', 'insurance')
  );

-- Grant anon permission on the table (policies restrict further)
grant insert on public.professional_documents to anon;

-- =============================================================================
-- STORAGE: ANON INSERT POLICY
-- Allows anon to upload files to professional-documents bucket
-- Path must match: professionals/{professional_id}/(photo|insurance)/*
-- =============================================================================

drop policy if exists "professional_documents_storage_insert_anon" on storage.objects;
create policy "professional_documents_storage_insert_anon"
  on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'professional-documents'
    -- Path must start with 'professionals/' and contain '/photo/' or '/insurance/'
    and (
      name ~ '^professionals/[0-9a-f-]+/photo/'
      or name ~ '^professionals/[0-9a-f-]+/insurance/'
    )
  );

-- Note: Anon cannot SELECT (download) files - only staff/admin can view uploaded docs
