-- Migration: Contract Local Storage
-- Created: 2026-01-27
-- Description: Add columns for locally stored PDF and audit log

-- =============================================================================
-- ADD LOCAL STORAGE COLUMNS
-- =============================================================================

-- Path to the signed PDF in Supabase Storage
alter table public.service_contracts
add column if not exists signed_pdf_storage_path text;

-- DocuSeal audit log (JSON blob)
alter table public.service_contracts
add column if not exists audit_log jsonb;

-- Clinic signer info (who pre-signed for the clinic)
alter table public.service_contracts
add column if not exists clinic_signer_name text default 'Christine Sirois';

alter table public.service_contracts
add column if not exists clinic_signed_at timestamptz;

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on column public.service_contracts.signed_pdf_storage_path is 'Path to signed PDF in Supabase Storage (contracts bucket)';
comment on column public.service_contracts.audit_log is 'DocuSeal audit trail stored locally as JSON';
comment on column public.service_contracts.clinic_signer_name is 'Name of clinic representative who pre-signed';
comment on column public.service_contracts.clinic_signed_at is 'Timestamp when clinic representative signed';
