-- =============================================================================
-- Signing function support: one request read for the service role, discarding a system file
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.33 (the signing
--          functions), follow-up of Task 3.31 (core_signing) and Task 3.24 (core_storage)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Two gaps found while writing the functions (lane F; the DB lane reviews this migration):
--   - signing-webhook and signing-sync store the signed PDF with register_system_file, and
--     complete_signature_request only accepts a file carrying the request's view permission.
--     Neither function had a way to read that permission (apply_signing_event and the reconcile
--     list do not return it; the tables are closed to the service role, CLAUDE.md §7 forbids
--     table reads). get_signing_request returns it.
--   - A draft that Documenso reports completed (a send that died before
--     mark_signature_request_sent) can be recovered while its rendered PDF is still staged: the
--     function then needs that file and the signers' roles and signing orders (Documenso's
--     recipients are matched by signing order, never by address). get_signing_request returns
--     them too.
--   - register_system_file's header says a caller whose upload fails soft-deletes the row through
--     its module's service RPC; core had none. discard_system_file is that RPC for every system
--     file still staged (P3-17), so a row whose object never arrived stops being readable at once
--     instead of lingering `ready` until its staging ends.
-- * get_signing_request(p_org_id, p_id) → jsonb, or null (unknown id, another org's). Scoped by
--   the org the caller resolved (webhook: `?org=` after the secret; reconcile: the job's org).
--   No address or name: signers are `{role, order, recipient_id}`. `staged_source_file_id` only
--   for a draft: its newest `signing_source` system file, ready, still staged (mark_..._sent
--   would refuse any other) and with the request's view permission.
-- * discard_system_file(p_org_id, p_file_id) → true when it soft-deleted the file: of that org,
--   `ready`, a system file (no uploader) still staged (`retain_until` set). A file a request or a
--   module RPC took (retain_until cleared) is never touched; nor is a client upload. The object
--   (if any) is removed by storage-cleanup like any deleted file.
-- * Both are service role only (security definer, set search_path = '').
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_function_support', true);

-- One request of the org for the signing functions (header). Reads the request by primary key,
-- its signers through (request_id, role), and the staged source file through
-- stored_files_subject_idx (org_id, module_key, subject_type, subject_id).
create function public.get_signing_request(p_org_id uuid, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', r.id,
           'module_key', r.module_key,
           'purpose', r.purpose,
           'status', r.status,
           'view_permission', r.view_permission,
           'documenso_document_id', r.documenso_document_id,
           'envelope_id', r.envelope_id,
           'expires_at', r.expires_at,
           'completed_event_at', r.completed_event_at,
           'last_error', r.last_error,
           'staged_source_file_id',
             case when r.status = 'draft' then
               (select f.id
                  from public.stored_files f
                 where f.org_id = r.org_id
                   and f.module_key = 'core'
                   and f.subject_type = 'signature_request'
                   and f.subject_id = r.id
                   and f.purpose = 'signing_source'
                   and f.status = 'ready'
                   and f.uploaded_by is null
                   and f.view_permission = r.view_permission
                   and f.retain_until > pg_catalog.now()
                 order by f.created_at desc, f.id desc
                 limit 1)
             end,
           'signers',
             coalesce((select pg_catalog.jsonb_agg(
                                pg_catalog.jsonb_build_object('role', s.role, 'order', s.signing_order,
                                                              'recipient_id', s.documenso_recipient_id)
                                order by s.signing_order)
                         from public.signature_request_signers s
                        where s.request_id = r.id), '[]'::jsonb))
    from public.signature_requests r
   where r.id = p_id and r.org_id = p_org_id
$$;

-- Soft-deletes a staged system file of the org whose upload failed (header). True when it did.
create function public.discard_system_file(p_org_id uuid, p_file_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.stored_files f
     set status = 'deleted', deleted_at = pg_catalog.now()
   where f.id = p_file_id
     and f.org_id = p_org_id
     and f.status = 'ready'
     and f.uploaded_by is null
     and f.retain_until is not null;
  return found;
end;
$$;

revoke all on function
  public.get_signing_request(uuid, uuid),
  public.discard_system_file(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.get_signing_request(uuid, uuid),
  public.discard_system_file(uuid, uuid)
to service_role;
