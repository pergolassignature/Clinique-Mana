-- =============================================================================
-- Signing function support: one request read for the service role, recovering a draft Documenso
-- completed, discarding a signing system file, the org's Documenso credentials
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.33 (the signing
--          functions), follow-up of Task 3.31 (core_signing) and Task 3.24 (core_storage)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Gaps found while writing the functions (lane F; the DB lane reviews this migration):
--   - signing-webhook and signing-sync store the signed PDF with register_system_file, and
--     complete_signature_request only accepts a file carrying the request's view permission.
--     Neither function had a way to read that permission (apply_signing_event and the reconcile
--     list do not return it; the tables are closed to the service role, CLAUDE.md §7 forbids
--     table reads). get_signing_request returns it.
--   - A draft that Documenso reports completed (a send that died before
--     mark_signature_request_sent, or the earlier document of a re-send) must be recovered: the
--     contract is signed there. The function needs the signers' roles and signing orders
--     (Documenso's recipients are matched by signing order, never by address: the stored orders
--     are the ones sent, create_signature_request refusing other signers on the same key);
--     get_signing_request returns them. recover_signature_request then makes it `sent` with
--     completed_event_at stamped, whether or not its rendered PDF is still staged: the signed
--     PDF is what matters, so a source whose staging ended is recorded missing (source_file_id
--     null) instead of blocking the recovery. Only the draft's own recorded document is
--     recovered: the functions check Documenso's `externalId` (the request id) and this RPC the
--     document id, so another document (another instance's under the same id, a stale read) is
--     never adopted as this request's contract.
--   - register_system_file's header says a caller whose upload fails soft-deletes the row through
--     its module's service RPC; core had none. discard_system_file is that RPC for every system
--     file still staged (P3-17), so a row whose object never arrived stops being readable at once
--     instead of lingering `ready` until its staging ends.
-- * get_signing_request(p_org_id, p_id) → jsonb, or null (unknown id, another org's). Scoped by
--   the org the caller resolved (webhook: `?org=` after the secret; reconcile: the job's org).
--   No address or name: signers are `{role, order, recipient_id}`. `staged_source_file_id` only
--   for a draft: its newest `signing_source` system file, ready, still staged (mark_..._sent
--   would refuse any other) and with the request's view permission.
-- * recover_signature_request(p_org_id, p_id, p_documenso_document_id, p_envelope_id,
--   p_signer_recipients) → the source file it took (the draft's newest staged `signing_source`,
--   as get_signing_request picks it), or null when none is left (recorded missing). The caller
--   read the document COMPLETED at Documenso, checked its `externalId` is the request id, and
--   holds the draft's send claim. p_documenso_document_id must be the draft's recorded
--   documenso_document_id (a draft without one is never recovered). A live draft of the org
--   becomes `sent` (envelope id, recipients keyed by role as for mark_signature_request_sent,
--   sent_at, no expiry) with completed_event_at stamped, so nothing can expire, reject or cancel
--   it before the signed PDF is stored (complete_signature_request); its claim is released.
--   Anything else → 22023.
-- * discard_system_file(p_org_id, p_file_id) → true when it soft-deleted the file: of that org,
--   `ready`, a signing system file (`signing_source` or `signing_signed`, no uploader) still
--   staged (`retain_until` set). A file a request or a module RPC took (retain_until cleared) is
--   never touched; nor is a client upload or another purpose's file. The object (if any) is
--   removed by storage-cleanup like any deleted file.
-- * get_signing_credentials(p_org_id) → one row (base_url, api_key, expiry_days), none for an
--   org without signing settings; api_key null when none is stored. The address and the Vault key
--   come from one statement, so one snapshot (final Phase 3 review): set_signing_settings deletes
--   the key in the same transaction as an origin change, and two separate reads (the functions
--   read get_signing_context and get_org_secret in parallel before) could pair the new address
--   with the old key, sending it where it was never typed for. The key is matched to its Vault
--   secret by name, as get_org_secret does (20261007205802_core_bank_details.sql).
-- * All four are service role only (security definer, set search_path = '').
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

-- A draft Documenso completed becomes `sent`, completion stamped (header). Returns the source file
-- taken, or null.
create function public.recover_signature_request(
  p_org_id uuid,
  p_id uuid,
  p_documenso_document_id text,
  p_envelope_id text,
  p_signer_recipients jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.signature_requests%rowtype;
  v_source uuid;
begin
  select * into v_row from public.signature_requests r where r.id = p_id and r.org_id = p_org_id for update;
  if not found or v_row.status <> 'draft' or v_row.last_error is not distinct from 'abandoned' then
    raise exception 'Unknown request, or not a live draft' using errcode = '22023';
  end if;
  if p_documenso_document_id is null or p_documenso_document_id !~ '^[1-9][0-9]{0,14}$'
     or (p_envelope_id is not null and p_envelope_id !~ '^envelope_[A-Za-z0-9_-]{1,64}$') then
    raise exception 'Invalid document id or envelope id' using errcode = '22023';
  end if;
  -- Only the draft's own document (header): never one it did not record.
  if v_row.documenso_document_id is distinct from p_documenso_document_id then
    raise exception 'Not the request''s document' using errcode = '22023';
  end if;
  if not coalesce(private.signing_recipients_valid(v_row.id, p_signer_recipients), false) then
    raise exception 'One distinct recipient id per signer role of the request' using errcode = '22023';
  end if;

  update public.stored_files f
     set retain_until = null
   where f.id = (select x.id
                   from public.stored_files x
                  where x.org_id = v_row.org_id
                    and x.module_key = 'core'
                    and x.subject_type = 'signature_request'
                    and x.subject_id = v_row.id
                    and x.purpose = 'signing_source'
                    and x.status = 'ready'
                    and x.uploaded_by is null
                    and x.view_permission = v_row.view_permission
                    and x.retain_until > pg_catalog.now()
                  order by x.created_at desc, x.id desc
                  limit 1)
  returning f.id into v_source;

  update public.signature_request_signers s
     set documenso_recipient_id = e ->> 'recipient_id'
    from pg_catalog.jsonb_array_elements(p_signer_recipients) e
   where s.request_id = v_row.id and s.role = e ->> 'role';
  update public.signature_requests r
     set status = 'sent',
         envelope_id = p_envelope_id,
         source_file_id = v_source,
         sent_at = pg_catalog.now(),
         completed_event_at = pg_catalog.now(),
         last_error = null,
         send_started_at = null
   where r.id = v_row.id;
  return v_source;
end;
$$;

-- Soft-deletes a staged signing system file of the org whose upload failed (header). True when it
-- did.
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
     and f.purpose in ('signing_source', 'signing_signed')
     and f.status = 'ready'
     and f.uploaded_by is null
     and f.retain_until is not null;
  return found;
end;
$$;

-- The org's Documenso address, API key and invitation expiry, in one statement (header).
create function public.get_signing_credentials(p_org_id uuid)
returns table (base_url text, api_key text, expiry_days int)
language sql
stable
security definer
set search_path = ''
as $$
  select s.base_url, ds.decrypted_secret, s.expiry_days
    from public.signing_settings s
    left join public.org_secrets k
      on k.org_id = s.org_id and k.key = 'documenso_api_key'
    left join vault.decrypted_secrets ds
      on ds.id = k.vault_secret_id
     and ds.name = pg_catalog.format('org:%s:%s', k.org_id, k.key)
   where s.org_id = p_org_id
$$;

revoke all on function
  public.get_signing_request(uuid, uuid),
  public.recover_signature_request(uuid, uuid, text, text, jsonb),
  public.discard_system_file(uuid, uuid),
  public.get_signing_credentials(uuid)
from public, anon, authenticated;
grant execute on function
  public.get_signing_request(uuid, uuid),
  public.recover_signature_request(uuid, uuid, text, text, jsonb),
  public.discard_system_file(uuid, uuid),
  public.get_signing_credentials(uuid)
to service_role;
