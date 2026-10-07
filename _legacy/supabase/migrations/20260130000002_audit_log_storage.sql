-- Migration: audit_log_storage
-- Description: Add audit_log_storage_path column to document_instances
--              to store DocuSeal audit logs locally in Supabase Storage.

-- Add column for local audit log storage path
ALTER TABLE document_instances
ADD COLUMN IF NOT EXISTS audit_log_storage_path text;

-- Add comment for clarity
COMMENT ON COLUMN document_instances.audit_log_storage_path IS
  'Path to the locally stored audit log PDF from DocuSeal (in professional-documents bucket)';
