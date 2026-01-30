-- Migration: backfill_insurance_expiry
-- Purpose: Set expires_at for all existing insurance documents that don't have one
-- Created: 2026-01-27

-- =============================================================================
-- Update all insurance documents without expiry date
-- Uses the next_insurance_expiry_date function to calculate the correct date
-- =============================================================================

update public.professional_documents
set
  expires_at = public.next_insurance_expiry_date(created_at::date),
  updated_at = now()
where document_type = 'insurance'
  and expires_at is null;

-- Log how many were updated
do $$
declare
  updated_count integer;
begin
  get diagnostics updated_count = row_count;
  raise notice 'Updated % insurance documents with expiry date', updated_count;
end $$;
