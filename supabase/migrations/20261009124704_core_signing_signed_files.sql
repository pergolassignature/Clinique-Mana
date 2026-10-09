-- =============================================================================
-- Signing: what the signed-PDF downloads need (P4-500)
-- =============================================================================
-- Documenso's sealed PDF is our document (pages 1…N) followed by its « Certificat de signature »
-- and « Journal d'audit ». The app offers the document alone and the certificate pages alone, cut
-- in the browser (src/core/signing/pdf-split.ts), next to the full sealed file, which stays stored
-- untouched: Documenso's digital signature covers the whole file, so it is the legal proof.
--
-- Key choices
-- * `signature_requests.page_count`: N, the page count of the PDF this request sent (the
--   renderer's count, `renderPdf().pageCount`), recorded by mark_signature_request_sent. Null for
--   a request sent before this migration or recovered (recover_signature_request): the browser
--   then counts the pages of the stored source file (`source_file_id`), never guesses from text.
--   Every re-send records its own document's count.
-- * mark_signature_request_sent takes `p_page_count integer default null` (dropped and created:
--   a caller that names only the five earlier arguments still resolves to it). Anything but null
--   or 1–10000 → 22023.
-- * get_signing_request also returns the request's `title`: the signing functions name the stored
--   signed PDF from it (`_shared/signing-file-name.ts`, the same rule as the browser's downloads,
--   src/core/signing/file-names.ts). The title names the person: like signer names, it never
--   reaches a log, a claim or a report.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_signed_files', true);

alter table public.signature_requests
  add column page_count integer check (page_count between 1 and 10000);
comment on column public.signature_requests.page_count is
  'Pages of the document this request sent (N), from the renderer; the signed PDF adds Documenso''s certificate and audit log after them. Null: sent before it was recorded, or recovered.';

-- -----------------------------------------------------------------------------
-- mark_signature_request_sent: 20261008133453's, plus the page count
-- -----------------------------------------------------------------------------
drop function public.mark_signature_request_sent(uuid, text, uuid, jsonb, timestamptz);
create function public.mark_signature_request_sent(
  p_id uuid,
  p_envelope_id text,
  p_source_file_id uuid,
  p_signer_recipients jsonb,
  p_expires_at timestamptz,
  p_page_count integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.signature_requests%rowtype;
begin
  select * into v_row from public.signature_requests r where r.id = p_id for update;
  if not found or v_row.status <> 'draft' or v_row.last_error is not distinct from 'abandoned' then
    raise exception 'Unknown request, or not a live draft' using errcode = '22023';
  end if;
  if p_envelope_id is null or p_envelope_id !~ '^envelope_[A-Za-z0-9_-]{1,64}$'
     or p_expires_at is null or p_expires_at <= pg_catalog.now() then
    raise exception 'Invalid envelope id or expiry' using errcode = '22023';
  end if;
  if p_page_count is not null and p_page_count not between 1 and 10000 then
    raise exception 'Invalid page count' using errcode = '22023';
  end if;
  if not coalesce(private.signing_recipients_valid(v_row.id, p_signer_recipients), false) then
    raise exception 'One distinct recipient id per signer role of the request' using errcode = '22023';
  end if;

  update public.stored_files f
     set retain_until = null
   where f.id = p_source_file_id
     and f.org_id = v_row.org_id
     and f.purpose = 'signing_source'
     and f.status = 'ready'
     and f.uploaded_by is null
     and f.subject_type = 'signature_request'
     and f.subject_id = v_row.id
     and f.view_permission = v_row.view_permission
     and (f.retain_until is null or f.retain_until > pg_catalog.now());
  if not found then
    raise exception 'Invalid source file' using errcode = '22023';
  end if;

  update public.signature_request_signers s
     set documenso_recipient_id = e ->> 'recipient_id'
    from pg_catalog.jsonb_array_elements(p_signer_recipients) e
   where s.request_id = v_row.id and s.role = e ->> 'role';
  update public.signature_requests r
     set status = 'sent',
         superseded_envelope_ids = private.signing_superseded(r.superseded_envelope_ids, r.envelope_id, p_envelope_id),
         envelope_id = p_envelope_id,
         source_file_id = p_source_file_id,
         page_count = p_page_count,
         sent_at = pg_catalog.now(),
         expires_at = p_expires_at,
         last_error = null,
         send_started_at = null
   where r.id = v_row.id;
end;
$$;

revoke all on function public.mark_signature_request_sent(uuid, text, uuid, jsonb, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.mark_signature_request_sent(uuid, text, uuid, jsonb, timestamptz, integer)
  to service_role;

-- -----------------------------------------------------------------------------
-- get_signing_request: 20261008082519's, plus the title (the signed PDF's name)
-- -----------------------------------------------------------------------------
create or replace function public.get_signing_request(p_org_id uuid, p_id uuid)
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
           'title', r.title,
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
