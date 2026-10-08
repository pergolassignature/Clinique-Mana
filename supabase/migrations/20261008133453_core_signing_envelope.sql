-- =============================================================================
-- Signing on the Documenso envelope API: the envelope id is the one Documenso reference
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-documenso-envelope-api-plan.md §2.1 (decisions E-1…E-4)
-- ADR:     docs/adr/0005-documenso-replaces-docuseal.md (amended)
-- Follows: 20261008073909_core_signing.sql, 20261008082519_core_signing_function_support.sql
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The clinic's Documenso marks every `/api/v2/document/*` route deprecated; the functions move
--   to `/api/v2/envelope/*`, which never returns the numeric document id. The existing
--   `signature_requests.envelope_id` (its check `^envelope_[A-Za-z0-9_-]{1,64}$` unchanged, the
--   same regex as `ENVELOPE_ID` in supabase/functions/_shared/documenso.ts) becomes the request's
--   Documenso reference (E-1): every non-draft request has one (`signature_requests_sent_has_envelope`
--   replaces `signature_requests_check2`, the document check), and it is unique per org
--   (`signature_requests_org_id_envelope_id_key`: ids are per Documenso instance). The check stays
--   loose on purpose: a tighter one would refuse at mark_signature_request_sent, after the emails
--   left, if Documenso ever changed the id's length.
-- * `documenso_document_id` and `superseded_document_ids` are deprecated (E-2): nullable, never
--   written again, and still returned (null) by the read RPCs whose return type would otherwise
--   change (create_signature_request, get_signature_request, list_signature_requests_to_reconcile,
--   get_signing_request). A later cleanup migration drops both columns and those outputs.
--   Superseded envelopes go to `superseded_envelope_ids` (the same cap of 20, the same
--   private.signing_superseded).
-- * Staging holds no Documenso id (no Documenso is configured there): the guard below refuses to
--   run (P0001) if any request holds a document id without an envelope id, so "nothing to
--   migrate" is checked, not assumed.
-- * The four service-role RPCs whose parameters name the document are dropped and re-created
--   keyed by envelope (E-3): mark_signature_request_sent(p_id, p_envelope_id, p_source_file_id,
--   p_signer_recipients, p_expires_at), mark_signature_request_failed(p_id, p_error_code,
--   p_envelope_id), apply_signing_event(…, p_envelope_id, …) and recover_signature_request(p_org_id,
--   p_id, p_envelope_id, p_signer_recipients). Postgres cannot rename a parameter with `create or
--   replace`, and overloads would keep bodies that break the new check.
--   **Deviation** from conventions §1 (two steps before a destructive change): one step, approved
--   2026-10-08 and recorded in ADR 0005. Their only callers are this repo's functions
--   (_shared/rpc-contract.test.ts); none can run on staging (every send stops at `not_configured`).
-- * list_signature_requests_to_reconcile and set_signing_settings keep their signatures (`create or
--   replace`, grants kept): a draft's Documenso state is now "has an envelope id".
-- * No webhook_events change (E-4): new claim ids (`…:envelope_…`) cannot collide with old ones,
--   none exist on staging, and the retention job purges them.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_envelope', true);

-- E-2 guard: nothing to migrate, checked.
do $$
begin
  if exists (select 1 from public.signature_requests r
              where r.documenso_document_id is not null and r.envelope_id is null) then
    raise exception 'core_signing_envelope: a request holds a Documenso document id without an envelope id'
      using errcode = 'P0001';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Columns and checks
-- -----------------------------------------------------------------------------
alter table public.signature_requests
  -- Earlier Documenso envelopes of this request that a re-send (« Renvoyer ») replaced after
  -- cancelling them: their late webhooks are ignored instead of reported as unknown. The latest
  -- 20 (private.signing_superseded).
  add column superseded_envelope_ids text[] not null default '{}'
    check (pg_catalog.cardinality(superseded_envelope_ids) <= 20
           and pg_catalog.array_to_string(superseded_envelope_ids, ',', '-')
               ~ '^(envelope_[A-Za-z0-9_-]{1,64}(,envelope_[A-Za-z0-9_-]{1,64})*)?$'
           and (pg_catalog.cardinality(superseded_envelope_ids) = 0)
               = (pg_catalog.array_to_string(superseded_envelope_ids, ',', '-') = '')),
  add constraint signature_requests_org_id_envelope_id_key unique (org_id, envelope_id);

-- The unnamed table check of 20261008073909 (`status = 'draft' or (documenso_document_id is not
-- null and sent_at is not null)`) is the third multi-column check: signature_requests_check2.
-- Assert it before dropping it.
do $$
begin
  if (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
       where c.conrelid = 'public.signature_requests'::regclass and c.conname = 'signature_requests_check2')
     is distinct from 'CHECK (((status = ''draft''::text) OR ((documenso_document_id IS NOT NULL) AND (sent_at IS NOT NULL))))' then
    raise exception 'core_signing_envelope: signature_requests_check2 is not the sent-needs-a-document check'
      using errcode = 'P0001';
  end if;
end $$;
alter table public.signature_requests
  drop constraint signature_requests_check2,
  add constraint signature_requests_sent_has_envelope
    check (status = 'draft' or (envelope_id is not null and sent_at is not null));

comment on column public.signature_requests.documenso_document_id is
  'Deprecated (envelope API, 2026-10-08): never written; dropped by a later migration.';
comment on column public.signature_requests.superseded_document_ids is
  'Deprecated: superseded_envelope_ids replaces it.';

-- -----------------------------------------------------------------------------
-- The RPCs keyed by envelope (E-3)
-- -----------------------------------------------------------------------------
-- Documenso accepted and distributed the envelope. A live draft (not abandoned) becomes `sent`
-- with its envelope id, expiry and source file; each signer gets its recipient id
-- (p_signer_recipients: [{role, recipient_id}], one per signer of the request; a role is unique
-- per request, and create_signature_request returns the roles). The source file must be this
-- request's `signing_source` system file, ready, with the request's view permission; it stops
-- being staged. The send's claim is released; a re-send's earlier envelope joins
-- superseded_envelope_ids. Anything else → 22023.
drop function public.mark_signature_request_sent(uuid, text, text, uuid, jsonb, timestamptz);
create function public.mark_signature_request_sent(
  p_id uuid,
  p_envelope_id text,
  p_source_file_id uuid,
  p_signer_recipients jsonb,
  p_expires_at timestamptz
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
         sent_at = pg_catalog.now(),
         expires_at = p_expires_at,
         last_error = null,
         send_started_at = null
   where r.id = v_row.id;
end;
$$;

-- A creation step failed, or the reconcile abandons a stale draft (`abandoned`): the draft keeps
-- the error code and, when given, the Documenso envelope it created (a re-send's earlier envelope
-- joins superseded_envelope_ids), and the send's claim is released, so « Renvoyer » may try again
-- at once. A late call on an abandoned draft (a send that ends after the reconcile or
-- cancel_signature_request closed it) records the envelope only: the draft stays abandoned.
drop function public.mark_signature_request_failed(uuid, text, text, text);
create function public.mark_signature_request_failed(
  p_id uuid,
  p_error_code text,
  p_envelope_id text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$'
     or (p_envelope_id is not null and p_envelope_id !~ '^envelope_[A-Za-z0-9_-]{1,64}$') then
    raise exception 'Invalid error code or envelope id' using errcode = '22023';
  end if;
  update public.signature_requests r
     set last_error = case when r.last_error = 'abandoned' then r.last_error else p_error_code end,
         superseded_envelope_ids = private.signing_superseded(r.superseded_envelope_ids, r.envelope_id, p_envelope_id),
         envelope_id = coalesce(p_envelope_id, r.envelope_id),
         send_started_at = null
   where r.id = p_id and r.status = 'draft';
  if not found then
    raise exception 'Unknown request, or not a draft' using errcode = '22023';
  end if;
end;
$$;

-- Applies a Documenso event (signing-webhook, signing-sync) under Documenso's raw event names.
-- The row is found by id only (the envelope's externalId: Documenso holds our envelopes under
-- the request id), within p_org_id; a null p_request_id → 22023. There is no lookup by envelope
-- id alone: Documenso ids are per instance, so an envelope another instance numbered the same
-- (an org that changed address) must never act on this org's request. Returns `not_found` (no
-- row in the org, or a sent or closed request whose envelope id is another one, neither current
-- nor superseded), `ignored` (a superseded envelope of the request: a re-send cancelled it; a
-- disabled module, an abandoned draft, a terminal request, an unknown event, or nothing to
-- change), `retry` (a draft not abandoned whose Documenso envelope exists: a send under way or
-- failed part way, whose envelope may be a re-send's new one not recorded yet; the webhook
-- answers 409 so Documenso retries, and the reconcile settles a failed one) or `applied`.
-- Transitions (monotonic, 20261008073909's header):
--   DOCUMENT_OPENED            the recipient pending → viewed; the request sent → viewed
--   DOCUMENT_SIGNED,
--   DOCUMENT_RECIPIENT_COMPLETED  the recipient → signed (and viewed); the request sent → viewed
--   DOCUMENT_COMPLETED         every signer → signed; completed_event_at stamped; needs_download
--                              (complete_signature_request then stores the signed PDF and sets
--                              `signed`)
--   DOCUMENT_REJECTED          the request → rejected with the reason (control characters
--                              removed, cut to 500); the recipient → rejected
--   DOCUMENT_CANCELLED         the request → cancelled
-- After DOCUMENT_COMPLETED, a rejection or cancellation is ignored.
-- p_at (the provider's time, at most now) stamps the change.
drop function public.apply_signing_event(uuid, uuid, text, text, text, timestamptz, text);
create function public.apply_signing_event(
  p_org_id uuid,
  p_request_id uuid,
  p_envelope_id text,
  p_event text,
  p_recipient_id text,
  p_at timestamptz,
  p_reason text
)
returns table (outcome text, request_id uuid, module_key text, needs_download boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row public.signature_requests%rowtype;
  v_at timestamptz := least(coalesce(p_at, pg_catalog.now()), pg_catalog.now());
  v_changed bigint := 0;
  v_count bigint;
begin
  if p_org_id is null or p_request_id is null or p_event is null then
    raise exception 'Organization, request and event are required' using errcode = '22023';
  end if;

  select * into v_row from public.signature_requests r
   where r.id = p_request_id and r.org_id = p_org_id
     for update;
  if v_row.id is null then
    return query select 'not_found'::text, null::uuid, null::text, false;
    return;
  end if;
  -- An earlier envelope a re-send cancelled: its late events are expected.
  if p_envelope_id = any (v_row.superseded_envelope_ids) then
    return query select 'ignored'::text, v_row.id, v_row.module_key, false;
    return;
  end if;
  -- A draft's send may be creating a new envelope (a re-send): only a request past its draft
  -- has one envelope id for good.
  if v_row.status <> 'draft' and p_envelope_id is not null
     and v_row.envelope_id <> p_envelope_id then
    return query select 'not_found'::text, null::uuid, null::text, false;
    return;
  end if;
  if not public.module_enabled_for_org(v_row.org_id, v_row.module_key) then
    return query select 'ignored'::text, v_row.id, v_row.module_key, false;
    return;
  end if;
  if v_row.status = 'draft' then
    return query
      select case when coalesce(v_row.last_error, '') <> 'abandoned'
                   and coalesce(v_row.envelope_id, p_envelope_id) is not null
                  then 'retry' else 'ignored' end,
             v_row.id, v_row.module_key, false;
    return;
  end if;
  if v_row.status not in ('sent', 'viewed') then
    return query select 'ignored'::text, v_row.id, v_row.module_key, false;
    return;
  end if;

  case p_event
    when 'DOCUMENT_OPENED' then
      update public.signature_request_signers s
         set status = 'viewed', viewed_at = coalesce(s.viewed_at, v_at)
       where s.request_id = v_row.id and s.documenso_recipient_id = p_recipient_id and s.status = 'pending';
      get diagnostics v_changed = row_count;
      update public.signature_requests r
         set status = 'viewed', viewed_at = coalesce(r.viewed_at, v_at)
       where r.id = v_row.id and r.status = 'sent';
      get diagnostics v_count = row_count;
      v_changed := v_changed + v_count;
    when 'DOCUMENT_SIGNED', 'DOCUMENT_RECIPIENT_COMPLETED' then
      update public.signature_request_signers s
         set status = 'signed', viewed_at = coalesce(s.viewed_at, v_at), signed_at = v_at
       where s.request_id = v_row.id and s.documenso_recipient_id = p_recipient_id
         and s.status in ('pending', 'viewed');
      get diagnostics v_changed = row_count;
      if v_changed > 0 then
        update public.signature_requests r
           set status = 'viewed', viewed_at = coalesce(r.viewed_at, v_at)
         where r.id = v_row.id and r.status = 'sent';
      end if;
    when 'DOCUMENT_COMPLETED' then
      update public.signature_request_signers s
         set status = 'signed', viewed_at = coalesce(s.viewed_at, v_at), signed_at = coalesce(s.signed_at, v_at)
       where s.request_id = v_row.id and s.status in ('pending', 'viewed');
      update public.signature_requests r
         set completed_event_at = v_at
       where r.id = v_row.id and r.completed_event_at is null;
      return query select 'applied'::text, v_row.id, v_row.module_key, true;
      return;
    when 'DOCUMENT_REJECTED' then
      if v_row.completed_event_at is null then
        update public.signature_request_signers s
           set status = 'rejected', rejected_at = v_at
         where s.request_id = v_row.id and s.documenso_recipient_id = p_recipient_id
           and s.status in ('pending', 'viewed');
        update public.signature_requests r
           set status = 'rejected', rejected_at = v_at,
               rejection_reason = nullif(pg_catalog.left(pg_catalog.btrim(
                 pg_catalog.regexp_replace(p_reason, '[[:cntrl:]]', ' ', 'g')), 500), '')
         where r.id = v_row.id;
        v_changed := 1;
      end if;
    when 'DOCUMENT_CANCELLED' then
      if v_row.completed_event_at is null then
        update public.signature_requests r
           set status = 'cancelled', cancelled_at = v_at
         where r.id = v_row.id;
        v_changed := 1;
      end if;
    else
      null;
  end case;

  return query select case when v_changed > 0 then 'applied' else 'ignored' end, v_row.id, v_row.module_key, false;
end;
$$;

-- A draft Documenso completed becomes `sent`, completion stamped (20261008082519's header):
-- p_envelope_id must be the draft's recorded envelope id (a draft without one is never
-- recovered; the caller checked the envelope's `externalId` is the request id). Takes the
-- draft's newest staged `signing_source` (returned), or none (recorded missing). Anything
-- else → 22023.
drop function public.recover_signature_request(uuid, uuid, text, text, jsonb);
create function public.recover_signature_request(
  p_org_id uuid,
  p_id uuid,
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
  if p_envelope_id is null or p_envelope_id !~ '^envelope_[A-Za-z0-9_-]{1,64}$' then
    raise exception 'Invalid envelope id' using errcode = '22023';
  end if;
  -- Only the draft's own envelope: never one it did not record.
  if v_row.envelope_id is distinct from p_envelope_id then
    raise exception 'Not the request''s envelope' using errcode = '22023';
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
         source_file_id = v_source,
         sent_at = pg_catalog.now(),
         completed_event_at = pg_catalog.now(),
         last_error = null,
         send_started_at = null
   where r.id = v_row.id;
  return v_source;
end;
$$;

revoke all on function
  public.mark_signature_request_sent(uuid, text, uuid, jsonb, timestamptz),
  public.mark_signature_request_failed(uuid, text, text),
  public.apply_signing_event(uuid, uuid, text, text, text, timestamptz, text),
  public.recover_signature_request(uuid, uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function
  public.mark_signature_request_sent(uuid, text, uuid, jsonb, timestamptz),
  public.mark_signature_request_failed(uuid, text, text),
  public.apply_signing_event(uuid, uuid, text, text, text, timestamptz, text),
  public.recover_signature_request(uuid, uuid, text, jsonb)
to service_role;

-- -----------------------------------------------------------------------------
-- Same signatures, a draft's Documenso state read from its envelope id
-- -----------------------------------------------------------------------------
-- core.signing_reconcile (signing-sync, one org at a time): 20261008073909's comment, with "a
-- Documenso document" now "an envelope id": a draft with one → `sync` after an hour (read it,
-- recover or cancel it), a draft without one → `abandon` after a day. `documenso_document_id`
-- is deprecated (header) and comes back null.
create or replace function public.list_signature_requests_to_reconcile(p_org_id uuid, p_limit int default 100)
returns table (
  id uuid,
  module_key text,
  status text,
  documenso_document_id text,
  envelope_id text,
  expires_at timestamptz,
  action text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.module_key, r.status, r.documenso_document_id, r.envelope_id, r.expires_at, a.action
    from public.signature_requests r
    cross join lateral (
      select case when r.status = 'draft' then case when r.envelope_id is null then 'abandon' else 'sync' end
                  when r.completed_event_at is not null then 'sync'
                  when r.expires_at < pg_catalog.now() then 'expire'
                  else 'sync' end as action) a
   where r.org_id = p_org_id
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))
     and ((r.status = 'draft'
           and coalesce(r.last_send_at, r.created_at)
               < pg_catalog.now() - case when r.envelope_id is null then interval '1 day'
                                         else interval '1 hour' end)
          or (r.status <> 'draft'
              and (r.sent_at < pg_catalog.now() - interval '1 day' or r.expires_at < pg_catalog.now())))
     and public.module_enabled_for_org(r.org_id, r.module_key)
   order by a.action in ('expire', 'abandon') desc, r.expires_at nulls last, r.created_at, r.id
   limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

-- 20261008073909's set_signing_settings, with "a draft holding a Documenso document" now "a draft
-- holding an envelope id": an origin change is refused (P0001) while one is open at the current
-- instance.
create or replace function public.set_signing_settings(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_old text;
  v_base_url text;
  v_expiry int;
  v_cleared boolean := false;
begin
  if not private.has_permission('settings.integrations_manage') then
    raise exception 'Permission refusée : settings.integrations_manage' using errcode = '42501';
  end if;
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' or p = '{}'::jsonb
     or exists (select 1 from pg_catalog.jsonb_object_keys(p) k where k not in ('base_url', 'expiry_days')) then
    raise exception 'Réglages de signature invalides : base_url et/ou expiry_days attendus.' using errcode = '22023';
  end if;

  select s.base_url, s.expiry_days into v_old, v_expiry
    from public.signing_settings s
   where s.org_id = v_org
     for update;
  if not found then
    raise exception 'Réglages de signature introuvables.' using errcode = 'P0002';
  end if;
  v_base_url := v_old;

  if p ? 'base_url' then
    if pg_catalog.jsonb_typeof(p -> 'base_url') not in ('string', 'null') then
      raise exception 'L''adresse de l''instance doit être un texte.' using errcode = '22023';
    end if;
    v_base_url := nullif(pg_catalog.rtrim(pg_catalog.btrim(p ->> 'base_url', E' \t\r\n'), '/'), '');
    if v_base_url is not null and not private.signing_base_url_valid(v_base_url) then
      raise exception 'L''adresse de l''instance doit être une adresse https:// publique (un nom de domaine complet, sans adresse IP).'
        using errcode = '23514';
    end if;
  end if;
  if p ? 'expiry_days' then
    if pg_catalog.jsonb_typeof(p -> 'expiry_days') = 'null' then
      raise exception 'Le délai d''expiration est obligatoire.' using errcode = '23514';
    end if;
    if pg_catalog.jsonb_typeof(p -> 'expiry_days') <> 'number' or (p ->> 'expiry_days') !~ '^[0-9]{1,9}$' then
      raise exception 'Le délai d''expiration est un nombre entier de jours.' using errcode = '23514';
    end if;
    v_expiry := (p ->> 'expiry_days')::int;
  end if;

  if private.signing_base_url_origin(v_base_url) is distinct from private.signing_base_url_origin(v_old)
     and exists (select 1 from public.signature_requests r
                  where r.org_id = v_org
                    -- signature_requests_open_idx's predicate, then a draft only with an envelope.
                    and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))
                    and (r.status <> 'draft' or r.envelope_id is not null)) then
    raise exception 'Des demandes de signature sont encore en cours avec l''instance actuelle. Changez l''adresse une fois qu''elles sont signées, refusées, annulées ou expirées.'
      using errcode = 'P0001';
  end if;

  update public.signing_settings s
     set base_url = v_base_url,
         expiry_days = v_expiry,
         updated_by = auth.uid()
   where s.org_id = v_org;

  if private.signing_base_url_origin(v_base_url) is distinct from private.signing_base_url_origin(v_old) then
    delete from public.org_secrets s where s.org_id = v_org and s.key = 'documenso_api_key';
    v_cleared := found;
  end if;
  return pg_catalog.jsonb_build_object('api_key_cleared', v_cleared);
end;
$$;
