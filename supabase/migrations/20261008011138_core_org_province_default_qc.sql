-- =============================================================================
-- organizations.province: Québec by default
-- =============================================================================
-- Decision: docs/plans/2026-10-07-decisions-log.md #38 (a)
-- The clinic is in Québec. « Identité légale » used to show an empty province until someone
-- picked one. The default lives in the database, not in the form, so what the page shows is
-- always what is stored (and printed on documents).
-- - New organizations get 'QC' (column default).
-- - Existing nulls are backfilled to 'QC', audited as this migration.
-- - The column stays nullable and client-updatable (column grant of
--   20261007202941_core_organization_profile.sql, unchanged): the select's « Aucune » still
--   clears it, and the default only applies on insert.
-- Existing data: an organization already stored (staging) with no province becomes QC; the
-- local seed inserts its org after the migrations, so it gets the default.
-- =============================================================================

alter table public.organizations
  alter column province set default 'QC';

-- -----------------------------------------------------------------------------
-- Backfill
-- -----------------------------------------------------------------------------
select pg_catalog.set_config('app.audit_source', 'migration:core_org_province_default_qc', true);
update public.organizations set province = 'QC' where province is null;
select pg_catalog.set_config('app.audit_source', '', true);
