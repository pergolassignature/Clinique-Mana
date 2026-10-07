-- Migration: professionals_storage
-- Module: professionals
-- Gate: 3 — Storage Bucket + Policies
-- Created: 2026-01-18

-- =============================================================================
-- STORAGE BUCKET: professional-documents
-- Private bucket for professional documents (CV, diplomas, licenses, etc.)
-- Path structure: professionals/{professional_id}/{doc_type}/{uuid}.{ext}
-- =============================================================================

-- Create the private storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'professional-documents',
  'professional-documents',
  false, -- Private bucket
  10485760, -- 10MB file size limit
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
);

-- =============================================================================
-- STORAGE POLICIES
-- Phase 1: Staff/Admin only (providers no direct access)
-- =============================================================================

-- Admin can read all files
create policy "professional_documents_storage_select_admin"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'professional-documents'
    and (select public.get_my_role()) = 'admin'
  );

-- Staff can read all files
create policy "professional_documents_storage_select_staff"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'professional-documents'
    and (select public.get_my_role()) = 'staff'
  );

-- Admin can upload files
create policy "professional_documents_storage_insert_admin"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'professional-documents'
    and (select public.get_my_role()) = 'admin'
  );

-- Staff can upload files
create policy "professional_documents_storage_insert_staff"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'professional-documents'
    and (select public.get_my_role()) = 'staff'
  );

-- Admin can update files (replace)
create policy "professional_documents_storage_update_admin"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'professional-documents'
    and (select public.get_my_role()) = 'admin'
  );

-- Staff can update files (replace)
create policy "professional_documents_storage_update_staff"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'professional-documents'
    and (select public.get_my_role()) = 'staff'
  );

-- Only admin can delete files
create policy "professional_documents_storage_delete_admin"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'professional-documents'
    and (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- HELPER FUNCTION: Generate stable document path
-- Path format: professionals/{professional_id}/{doc_type}/{uuid}.{ext}
-- =============================================================================

create or replace function public.generate_professional_document_path(
  p_professional_id uuid,
  p_doc_type text,
  p_file_extension text
)
returns text
stable
as $$
begin
  return format(
    'professionals/%s/%s/%s.%s',
    p_professional_id,
    p_doc_type,
    gen_random_uuid(),
    lower(p_file_extension)
  );
end;
$$ language plpgsql;

comment on function public.generate_professional_document_path is 'Generate stable storage path for professional documents';
