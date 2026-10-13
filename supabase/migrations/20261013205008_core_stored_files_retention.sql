-- =============================================================================
-- Core: a module applies its retention policy to the files it keeps as proof
-- =============================================================================
-- Asked:   Clients C5b (plan §6 « C5 », C5b.2; decision R-50, CC-17): the sealed PDFs of ended
--          consents are kept for the duration the clinic sets, then purged by `storage-cleanup`.
-- Needs:   *_core_storage.sql (stored_files, list_files_to_purge), *_core_module_helpers.sql
--          (the other stored-files helpers a module calls instead of writing the table).
-- Rules:   docs/standards/database-conventions.md; docs/modules/core.md « How a module plugs in ».
--
-- Key choices
-- * private.set_stored_files_retention(org, purposes, file ids, until): sets the purge date of
--   ready files (or clears it, `until` null: kept forever). Only the purposes the caller names,
--   only its clinic's files, only rows that differ (one audited update each); never a pending,
--   deleted or purged file, so it cannot revive or hide one. `list_files_to_purge` then purges a
--   ready file once its date has passed, as for every staged file; `storage-sign` already refuses a
--   file past its date.
-- * Unlike private.extend_stored_files_retention (never shortens a hold), it may shorten one: the
--   caller is a module RPC applying the clinic's own policy, after its permission check. Security
--   invoker, EXECUTE granted to no role.
-- * Additive: one new private function.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_stored_files_retention', true);

-- Sets retain_until = p_until (null: kept forever) on the ready files p_file_ids of p_org whose
-- purpose is in p_purposes. Returns how many rows changed.
create function private.set_stored_files_retention(
  p_org uuid,
  p_purposes text[],
  p_file_ids uuid[],
  p_until timestamptz
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_org is null or p_purposes is null or pg_catalog.cardinality(p_purposes) = 0 then
    raise exception 'An org and the purposes are required' using errcode = '22023';
  end if;
  update public.stored_files f
     set retain_until = p_until
   where f.org_id = p_org
     and f.id = any (coalesce(p_file_ids, '{}'))
     and f.purpose = any (p_purposes)
     and f.status = 'ready'
     and f.retain_until is distinct from p_until;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.set_stored_files_retention(uuid, text[], uuid[], timestamptz)
  from public, anon, authenticated, service_role;
