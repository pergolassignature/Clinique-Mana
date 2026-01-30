-- Migration: DocuSeal Integration
-- Created: 2026-01-27
-- Description: Migrate service_contracts to use DocuSeal instead of custom signing

-- =============================================================================
-- DROP RLS POLICIES FIRST (they depend on token column)
-- =============================================================================

-- Drop old token-based policies BEFORE dropping the token column
drop policy if exists "Anon can read contracts by token" on public.service_contracts;
drop policy if exists "Anon can update contracts for signing" on public.service_contracts;
drop policy if exists "service_contracts_select_by_token_anon" on public.service_contracts;
drop policy if exists "service_contracts_update_anon_sign" on public.service_contracts;

-- =============================================================================
-- ADD DOCUSEAL COLUMNS
-- =============================================================================

-- DocuSeal submission ID (returned when creating submission)
alter table public.service_contracts
add column if not exists docuseal_submission_id bigint;

-- Signed PDF URL from DocuSeal
alter table public.service_contracts
add column if not exists signed_pdf_url text;

-- Create index for faster lookups by submission ID
create index if not exists idx_service_contracts_docuseal_submission
on public.service_contracts(docuseal_submission_id)
where docuseal_submission_id is not null;

-- =============================================================================
-- DROP OBSOLETE COLUMNS
-- These were used for custom signing, now handled by DocuSeal
-- =============================================================================

-- Token is no longer needed (DocuSeal generates its own)
alter table public.service_contracts
drop column if exists token;

-- Draft PDF path not needed (we send HTML to DocuSeal)
alter table public.service_contracts
drop column if exists draft_pdf_path;

-- Signature data now stored in DocuSeal
alter table public.service_contracts
drop column if exists signed_city;

alter table public.service_contracts
drop column if exists signed_date;

alter table public.service_contracts
drop column if exists signature_base64;

-- Opened tracking not needed (DocuSeal tracks this)
alter table public.service_contracts
drop column if exists opened_at;

-- =============================================================================
-- DROP CONTRACT_INITIALS TABLE
-- Initials are now handled by DocuSeal
-- =============================================================================

drop table if exists public.contract_initials;

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on column public.service_contracts.docuseal_submission_id is 'DocuSeal submission ID for tracking signing status';
comment on column public.service_contracts.signed_pdf_url is 'URL to signed PDF hosted on DocuSeal';
