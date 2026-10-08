-- =============================================================================
-- Signing: document templates with versions, signature requests and signing settings
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §6.2–§6.4
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.31 (P3-3, P3-19, P3-26,
--          P3-30, inconsistencies #9 and #11), with the notes from Tasks 3.30 and 3.32
-- Needs:   docs/plans/2026-10-08-professionals-module-plan.md, 4d.1–4d.3 (the service contract)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * `signing_settings`: one row per clinic (an `organizations` insert trigger, plus the backfill),
--   read with settings.view, written by set_signing_settings (settings.integrations_manage). The
--   Documenso key and webhook secret are org secrets (`documenso_api_key`,
--   `documenso_webhook_secret`), never here.
-- * The module gate. A template's view and edit permissions, and a request's view permission,
--   are permissions of the row's module: composite foreign keys to permissions (key, module_key).
--   Disabling a module removes its permissions from current_permission_keys(), so its templates
--   and requests disappear (inconsistency #9: every signing table is read through a
--   view_permission, P3-21 form).
-- * Templates are created by settings.manage holders (create_document_template; both permissions
--   belong to the template's module); a module's migration may also insert its templates
--   directly. Versions are created, edited, published and archived by holders of the template's
--   edit_permission (legacy A5); set_document_template_active (settings.manage) retires one.
-- * Versions (design §6.2, legacy A5): `draft → published → archived`, or a draft discarded
--   straight to `archived`. At most one draft and one published version per template (partial
--   unique indexes); publishing archives the previous one first, under the template's row lock.
--   Only a draft changes: the trigger `document_template_versions_guard` refuses, whoever writes
--   the row, any change to a published or archived version except its status and archived_at
--   moving forward (and created_by / published_by set to null when a profile goes), and any
--   status move backwards. `document_template_versions_no_delete` refuses deleting a published
--   or archived version, except through its template's cascade. A request only references a
--   published version, so a version is immutable once used.
-- * Bodies are the renderer's `PdfDocument` (supabase/functions/_shared/pdf/model.ts), validated
--   in full by the renderer (`checkDocument`). Here: an object of at most 256 KB; every string
--   in it, plus the Documenso email subject and message, uses only declared placeholders (the
--   email rule, `private.email_placeholder_error`, Task 3.30: the renderer fills every string).
--   Publishing also requires what the renderer and the fixed signing fields rely on: a title and
--   a footer; block types of the model's closed set; the body ends with its only `signaturePage`,
--   whose roles are unique and exactly the version's signers; `header.initialsFor` among them;
--   and an email subject.
-- * Requests (design §6.2): `draft` between the insert and Documenso's success (inconsistency
--   #11), then `sent → viewed → signed | rejected | cancelled | expired`. Transitions are
--   monotonic and come from Documenso (apply_signing_event: the webhook, and signing-sync for a
--   lost one); a terminal state never moves. A draft whose send is under way or failed after
--   Documenso created the document answers `retry` (the webhook answers 409, so Documenso
--   retries until the send ends or the reconcile settles it); an abandoned draft ignores events.
--   Per signer: `pending → viewed → signed | rejected`. `last_error` is a code; a failed draft
--   keeps the Documenso document it created (and its envelope id) so the reconcile can settle it.
--   `DOCUMENT_COMPLETED` stamps `completed_event_at` and answers needs_download (the webhook
--   stores the signed PDF and calls complete_signature_request); the request becomes `signed`
--   only with that file. Once `completed_event_at` is set, the request can no longer be expired,
--   rejected or cancelled (Documenso holds a signed contract): only completed, whatever its
--   expiry, and the reconcile syncs it until the download succeeds.
-- * Sends (Task 3.33 review): one at a time per request. begin_signature_request_send claims a
--   draft under its row lock (`send_started_at`; a claim older than the caller's staleness is a
--   dead send) and stamps `last_send_at` (never cleared: the reconcile's clock for drafts),
--   mark_signature_request_sent / _failed release it, and the reconcile claims a draft before
--   settling it. The same idempotency key must carry the same signers. A re-send
--   (« Renvoyer ») settles the draft's earlier Documenso document first (recovered when
--   completed, else cancelled) and the new document replaces it: the earlier id moves to
--   `superseded_document_ids`, whose late webhooks apply_signing_event ignores.
-- * One open request per record and purpose (Phase 4): the partial unique index
--   `signature_requests_open_subject_idx` (draft not abandoned, sent, viewed; the built-in test
--   document excepted). The idempotency key is checked first: the same key always returns its
--   own row, whatever its status; a new key for a record that already has an open request of
--   that purpose is refused (P0001) until cancel_signature_request closes the old one.
-- * Files: the unsigned and signed PDFs are registered by the function (register_system_file,
--   purposes `signing_source` and `signing_signed`), staged one day (P3-17). mark_..._sent and
--   complete_signature_request take them (clear `retain_until`); a file left behind by a failed
--   or retried step is purged by storage-cleanup. Paths follow Task 3.24 (`{org}/core/{request
--   id}/{file id}.pdf`), so a retried download registers a new file instead of overwriting.
-- * Personal data: signer addresses and names are redacted from the audit log (the timeline
--   shows roles), and so are a request's title (it names the person) and a rejection reason
--   (free text from the signer). Template bodies are redacted too: a version's row is its own
--   record, and bodies are up to 256 KB. Signer addresses are not readable by clients at all
--   (column grant: every column of signature_request_signers but `email`). Nothing here stores
--   a signing token or link.
-- * Reads: list_document_templates, list_subject_signature_requests (P3-26, keyset-paged on
--   (created_at, id)) and get_signature_request are security invoker, so RLS applies.
-- * Deviations from the plan:
--   - list_signature_requests_to_reconcile(p_org_id, p_limit) works per org, like storage-cleanup
--     (runJob runs one org at a time), returns the action to take (`sync`, `expire`, `abandon`)
--     and skips a disabled module's requests. One partial index of the open requests per org
--     replaces `(status, sent_at) where status in ('sent','viewed')`; abandoned drafts leave it.
--   - `documenso_document_id` is unique per org, not globally: ids are per Documenso instance,
--     and each org configures its own instance.
--   - create_signature_request also returns the row's status, its signers ([{role, signer_id}]),
--     last_error, created_at and the Documenso ids (an existing draft: its earlier document);
--     begin_signature_request_send, `send_started_at`, `last_send_at` and
--     `superseded_document_ids` are added;
--     mark_signature_request_sent takes the envelope id, and its recipients keyed by role
--     ([{role, recipient_id}]: a role is unique per request); mark_signature_request_failed
--     optionally records the document and envelope ids; list_subject_signature_requests takes
--     p_limit, p_before, p_before_id.
--   - `expired_at`, `archived_at`, `completed_event_at` and `cancelled_by` record those events;
--     cancel_signature_request and set_document_template_active are added (Phase 4, admin).
--   - `base_url` also refuses whitespace, `?` and `#`; set_signing_settings trims the value and
--     its trailing slashes.
--   - P3-34 (Task 3.34 review, SSRF): `base_url` is `https://` to a public DNS name only
--     (private.signing_base_url_valid: no IP literal, no single label, no localhost, .internal
--     or .local), or exactly `http://host.docker.internal:<port>` for the local fake, which the
--     functions refuse unless APP_URL is local (_shared/documenso.ts also resolves the host
--     before every request). set_signing_settings takes a jsonb patch (each card sends its own
--     field: no lost update between them), and deletes the `documenso_api_key` org secret when
--     the address's origin changes, so a new address always needs its key typed again.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing', true);

-- The target of the module-gate foreign keys below (a permission of a given module).
alter table public.permissions add constraint permissions_key_module_key_key unique (key, module_key);

-- A version's `signers`: at most three objects `{role, label, order, required}`, one per role
-- (`professional`, `clinic`, `client`: SIGNER_ROLES in _shared/pdf/model.ts).
create function private.signing_signers_valid(p_signers jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_signers) is distinct from 'array' then false
    when pg_catalog.jsonb_array_length(p_signers) > 3 then false
    else not exists (
           select 1 from pg_catalog.jsonb_array_elements(p_signers) s
            where case when pg_catalog.jsonb_typeof(s) <> 'object' then true
                       else (s ->> 'role') is null
                         or (s ->> 'role') not in ('professional', 'clinic', 'client')
                         or pg_catalog.jsonb_typeof(s -> 'label') is distinct from 'string'
                         or pg_catalog.length(pg_catalog.btrim(s ->> 'label')) not between 1 and 120
                         or pg_catalog.jsonb_typeof(s -> 'order') is distinct from 'number'
                         or (s ->> 'order') !~ '^[1-9]$'
                         or pg_catalog.jsonb_typeof(s -> 'required') is distinct from 'boolean'
                  end)
         and (select pg_catalog.count(distinct s ->> 'role') = pg_catalog.count(*)
                from pg_catalog.jsonb_array_elements(p_signers) s)
  end
$$;
revoke all on function private.signing_signers_valid(jsonb) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Signing settings
-- -----------------------------------------------------------------------------
-- A Documenso address the server may call (P3-30, P3-34; the functions send the API key there):
-- - `https://` to a public DNS name: at least two labels of [a-z0-9-] (1–63 each, no leading or
--   trailing hyphen, so no IPv6 literal, no empty label), not `localhost` nor under `.localhost`,
--   `.internal` or `.local`, and a last label that is neither all digits nor `0x…` (URL parsers
--   read such a host as an IPv4 literal: `1.2.3.4`, `127.1`, `0x7f.1`); an optional port; a path
--   without whitespace, `?` or `#`; at most 2 048 characters;
-- - or exactly `http://host.docker.internal:<port>`, the local fake (`npm run fake:documenso`,
--   P3-23). A check cannot know the environment: the functions refuse this host unless APP_URL
--   is local (_shared/documenso.ts, which also resolves every host and refuses private addresses).
-- Null for null (a check passes it: no instance yet).
create function private.signing_base_url_valid(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_url is null then null
    when pg_catalog.length(p_url) > 2048 then false
    when p_url ~ '^http://host\.docker\.internal:[0-9]{1,5}(/[^[:space:]?#]*)?$' then true
    when p_url !~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]?#]*)?$' then false
    else (select h ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
             and pg_catalog.length(h) <= 253
             and h !~ '(^|\.)(localhost|internal|local)$'
             and h !~ '(^|\.)([0-9]+|0x[0-9a-f]*)$'
            from pg_catalog.substring(p_url, '^https://([a-z0-9.-]+)') h)
  end
$$;
revoke all on function private.signing_base_url_valid(text) from public, anon, authenticated, service_role;

-- The origin (scheme, host, port) of a valid base URL, `:443` dropped for https; null for null.
create function private.signing_base_url_origin(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.substring(p_url, '^([a-z]+://[^/]+)'), '^(https://[^/:]+):443$', '\1')
$$;
revoke all on function private.signing_base_url_origin(text) from public, anon, authenticated, service_role;

create table public.signing_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- The clinic's Documenso instance (private.signing_base_url_valid).
  base_url text check (base_url is null or private.signing_base_url_valid(base_url)),
  -- Days before an invitation expires (Documenso's envelope expiry, and the reconcile job).
  expiry_days int not null default 7 check (expiry_days between 1 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null
);
create index signing_settings_updated_by_idx on public.signing_settings (updated_by);

create trigger signing_settings_set_updated_at
  before update on public.signing_settings
  for each row execute function private.set_updated_at();
create trigger signing_settings_audit
  after insert or update or delete on public.signing_settings
  for each row execute function private.audit_trigger();

alter table public.signing_settings enable row level security;
revoke all on public.signing_settings from anon, authenticated, service_role;
grant select on public.signing_settings to authenticated;
create policy signing_settings_select on public.signing_settings
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('settings.view'))
  );

create function private.seed_org_signing_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.signing_settings (org_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.seed_org_signing_settings() from public, anon, authenticated, service_role;

create trigger organizations_seed_signing_settings
  after insert on public.organizations
  for each row execute function private.seed_org_signing_settings();

-- Backfill (staging): the same row for every existing org, audited as this migration.
insert into public.signing_settings (org_id)
select o.id from public.organizations o
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Document templates
-- -----------------------------------------------------------------------------
create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- `<module>.<name>`, like permission and email template keys (P3-20).
  key text not null check (key ~ '^[a-z_]+\.[a-z0-9_]+$'),
  module_key text not null references public.modules(key),
  title text not null check (pg_catalog.length(title) between 1 and 200 and pg_catalog.btrim(title) <> ''),
  description text check (pg_catalog.length(description) <= 1000),
  view_permission text not null,
  edit_permission text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key),
  -- Target of the versions' composite key.
  unique (id, org_id),
  check (pg_catalog.split_part(key, '.', 1) = module_key),
  -- The module gate (header).
  foreign key (view_permission, module_key) references public.permissions (key, module_key),
  foreign key (edit_permission, module_key) references public.permissions (key, module_key)
);
create index document_templates_module_key_idx on public.document_templates (module_key);
create index document_templates_view_permission_idx on public.document_templates (view_permission);
create index document_templates_edit_permission_idx on public.document_templates (edit_permission);
create index document_templates_created_by_idx on public.document_templates (created_by);

create trigger document_templates_set_updated_at
  before update on public.document_templates
  for each row execute function private.set_updated_at();
create trigger document_templates_audit
  after insert or update or delete on public.document_templates
  for each row execute function private.audit_trigger();

alter table public.document_templates enable row level security;
revoke all on public.document_templates from anon, authenticated, service_role;
grant select on public.document_templates to authenticated;
-- Served by (org_id, key) and the row's permission tested against the array once (P3-21).
create policy document_templates_select on public.document_templates
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and view_permission = any ((select private.current_permission_keys())::text[])
  );

create table public.document_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  org_id uuid not null,
  version int not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- A `PdfDocument` (header).
  body jsonb not null default '{}'
    check (pg_catalog.jsonb_typeof(body) = 'object' and pg_catalog.pg_column_size(body) <= 262144),
  -- Same items as email_template_defaults.variables.
  variables jsonb not null default '[]' check (private.email_variables_valid(variables)),
  signers jsonb not null default '[]' check (private.signing_signers_valid(signers)),
  -- Documenso's invitation email (P3-3): subject and message, with declared placeholders only.
  email_subject text not null default '' check (pg_catalog.length(email_subject) <= 200 and email_subject !~ '[\r\n]'),
  email_message text not null default '' check (pg_catalog.length(email_message) <= 5000),
  created_by uuid references public.profiles(user_id) on delete set null,
  published_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz,
  foreign key (template_id, org_id) references public.document_templates (id, org_id) on delete cascade,
  unique (template_id, version),
  -- Target of the requests' composite key.
  unique (id, org_id),
  check (status <> 'published' or published_at is not null),
  check ((status = 'archived') = (archived_at is not null))
);
create unique index document_template_versions_published_idx
  on public.document_template_versions (template_id) where status = 'published';
create unique index document_template_versions_draft_idx
  on public.document_template_versions (template_id) where status = 'draft';
create index document_template_versions_created_by_idx on public.document_template_versions (created_by);
create index document_template_versions_published_by_idx on public.document_template_versions (published_by);

-- Only a draft changes; a status never moves backwards (header). Whoever writes the row. A
-- frozen version keeps every column but its status and archived_at (moving forward: the check
-- constraints tie archived_at to `archived`), updated_at, and created_by / published_by set to
-- null (their foreign keys' `on delete set null`).
create function private.guard_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and ((pg_catalog.to_jsonb(new) - array['status', 'archived_at', 'updated_at', 'created_by', 'published_by'])
          is distinct from
          (pg_catalog.to_jsonb(old) - array['status', 'archived_at', 'updated_at', 'created_by', 'published_by'])
          or (new.created_by is not null and new.created_by is distinct from old.created_by)
          or (new.published_by is not null and new.published_by is distinct from old.published_by)
          or (old.archived_at is not null and new.archived_at is distinct from old.archived_at)) then
    raise exception 'Seule une version brouillon peut être modifiée.' using errcode = 'P0001';
  end if;
  if new.status <> old.status
     and not ((old.status = 'draft' and new.status in ('published', 'archived'))
              or (old.status = 'published' and new.status = 'archived')) then
    raise exception 'A template version cannot move from % to %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_template_version() from public, anon, authenticated, service_role;

create trigger document_template_versions_guard
  before update on public.document_template_versions
  for each row execute function private.guard_template_version();

-- A published or archived version is history: deleted only with its template (the foreign key's
-- cascade runs this trigger one level down), never on its own. A draft may go.
create function private.guard_template_version_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and pg_catalog.pg_trigger_depth() < 2 then
    raise exception 'Une version publiée ou archivée ne peut pas être supprimée.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_template_version_delete() from public, anon, authenticated, service_role;

create trigger document_template_versions_no_delete
  before delete on public.document_template_versions
  for each row execute function private.guard_template_version_delete();
create trigger document_template_versions_set_updated_at
  before update on public.document_template_versions
  for each row execute function private.set_updated_at();
create trigger document_template_versions_audit
  after insert or update or delete on public.document_template_versions
  for each row execute function private.audit_trigger('body');

alter table public.document_template_versions enable row level security;
revoke all on public.document_template_versions from anon, authenticated, service_role;
grant select on public.document_template_versions to authenticated;
-- Through the template's permission: one indexed lookup on its primary key.
create policy document_template_versions_select on public.document_template_versions
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and exists (select 1 from public.document_templates t
                 where t.id = template_id
                   and t.view_permission = any ((select private.current_permission_keys())::text[]))
  );

-- -----------------------------------------------------------------------------
-- Signature requests
-- -----------------------------------------------------------------------------
create table public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.modules(key),
  -- `<module>.<name>` (`professionals.service_contract`); `core.signing_test` is the built-in test
  -- document of « Signature électronique ».
  purpose text not null check (purpose ~ '^[a-z_]+\.[a-z0-9_]+$'),
  template_version_id uuid,
  -- The record the request is about (its timeline, P3-26).
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  subject_id uuid not null,
  title text not null check (pg_catalog.length(title) between 1 and 200 and title !~ '[[:cntrl:]]'),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'viewed', 'signed', 'rejected', 'cancelled', 'expired')),
  -- Documenso's ids (supabase/functions/_shared/documenso.ts): the document (numeric) and its
  -- envelope (`envelope_…`, for the envelope API).
  documenso_document_id text check (documenso_document_id ~ '^[1-9][0-9]{0,14}$'),
  envelope_id text check (envelope_id ~ '^envelope_[A-Za-z0-9_-]{1,64}$'),
  -- Earlier Documenso documents of this request that a re-send (« Renvoyer ») replaced after
  -- cancelling them: their late webhooks are ignored instead of reported as unknown. The latest
  -- 20 (private.signing_superseded).
  superseded_document_ids text[] not null default '{}'
    check (pg_catalog.cardinality(superseded_document_ids) <= 20
           and pg_catalog.array_to_string(superseded_document_ids, ',', '-') ~ '^([1-9][0-9]{0,14}(,[1-9][0-9]{0,14})*)?$'
           and (pg_catalog.cardinality(superseded_document_ids) = 0)
               = (pg_catalog.array_to_string(superseded_document_ids, ',', '-') = '')),
  -- When the current send claimed the draft (begin_signature_request_send); null when none is
  -- under way (mark_signature_request_sent and _failed release it). A claim older than the
  -- caller's staleness is a send that died.
  send_started_at timestamptz,
  -- When the latest claim started (begin_signature_request_send: a send, or a settle); never
  -- cleared, so a draft whose last send failed (its claim released) still counts from that send:
  -- the reconcile's staleness for drafts.
  last_send_at timestamptz,
  -- One per user action: a double click or a retry returns the same request.
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_:.-]{1,200}$'),
  source_file_id uuid references public.stored_files(id),
  signed_file_id uuid references public.stored_files(id),
  signed_sha256 text check (signed_sha256 ~ '^[0-9a-f]{64}$'),
  view_permission text not null,
  -- A code, never a provider message (P3-30).
  last_error text check (last_error ~ '^[a-z0-9_]{1,64}$'),
  rejection_reason text check (pg_catalog.length(rejection_reason) <= 500),
  expires_at timestamptz,
  sent_by uuid,
  -- Who closed the request through cancel_signature_request (null: the system, or Documenso).
  cancelled_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  viewed_at timestamptz,
  completed_at timestamptz,
  -- When Documenso said DOCUMENT_COMPLETED: the contract is signed there, even before the signed
  -- PDF is stored (completed_at). Protects the request from expiry, rejection and cancellation.
  completed_event_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  unique (org_id, idempotency_key),
  unique (org_id, documenso_document_id),
  -- Target of the signers' composite key.
  unique (id, org_id),
  check (pg_catalog.split_part(purpose, '.', 1) = module_key),
  -- Only the built-in test document has no template (P3-30).
  check (template_version_id is not null or purpose = 'core.signing_test'),
  check (status = 'draft' or (documenso_document_id is not null and sent_at is not null)),
  check (status <> 'signed' or (signed_file_id is not null and signed_sha256 is not null and completed_at is not null)),
  foreign key (template_version_id, org_id) references public.document_template_versions (id, org_id),
  -- The module gate (header).
  foreign key (view_permission, module_key) references public.permissions (key, module_key),
  foreign key (sent_by, org_id) references public.profiles (user_id, org_id) on delete set null (sent_by),
  foreign key (cancelled_by, org_id) references public.profiles (user_id, org_id) on delete set null (cancelled_by)
);
-- A subject's requests, newest first: list_subject_signature_requests (keyset), the org FK and
-- the RLS org predicate.
create index signature_requests_subject_idx
  on public.signature_requests (org_id, subject_type, subject_id, created_at desc, id desc);
-- The open requests of an org (list_signature_requests_to_reconcile), oldest first.
create index signature_requests_open_idx on public.signature_requests (org_id, created_at)
  where status in ('sent', 'viewed') or (status = 'draft' and coalesce(last_error, '') <> 'abandoned');
-- One open request per record and purpose (header): the same predicate, so an abandoned draft
-- frees its record. The built-in test document is left out (an admin may send several).
create unique index signature_requests_open_subject_idx
  on public.signature_requests (org_id, subject_type, subject_id, purpose)
  where (status in ('sent', 'viewed') or (status = 'draft' and coalesce(last_error, '') <> 'abandoned'))
    and purpose <> 'core.signing_test';
create index signature_requests_module_key_idx on public.signature_requests (module_key);
create index signature_requests_template_version_id_idx on public.signature_requests (template_version_id);
create index signature_requests_view_permission_idx on public.signature_requests (view_permission);
create index signature_requests_source_file_id_idx on public.signature_requests (source_file_id) where source_file_id is not null;
create index signature_requests_signed_file_id_idx on public.signature_requests (signed_file_id) where signed_file_id is not null;
create index signature_requests_sent_by_idx on public.signature_requests (sent_by) where sent_by is not null;
create index signature_requests_cancelled_by_idx on public.signature_requests (cancelled_by) where cancelled_by is not null;

create trigger signature_requests_set_updated_at
  before update on public.signature_requests
  for each row execute function private.set_updated_at();
create trigger signature_requests_audit
  after insert or update or delete on public.signature_requests
  for each row execute function private.audit_trigger('title', 'rejection_reason');

alter table public.signature_requests enable row level security;
revoke all on public.signature_requests from anon, authenticated, service_role;
grant select on public.signature_requests to authenticated;
create policy signature_requests_select on public.signature_requests
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and view_permission = any ((select private.current_permission_keys())::text[])
  );

create table public.signature_request_signers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  org_id uuid not null,
  role text not null check (role in ('professional', 'clinic', 'client')),
  name text not null check (pg_catalog.length(name) between 1 and 200 and name !~ '[[:cntrl:]]'),
  email text not null check (private.is_mailbox(email)),
  signing_order smallint not null check (signing_order between 1 and 9),
  documenso_recipient_id text check (documenso_recipient_id ~ '^[1-9][0-9]{0,14}$'),
  status text not null default 'pending' check (status in ('pending', 'viewed', 'signed', 'rejected')),
  viewed_at timestamptz,
  signed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (request_id, org_id) references public.signature_requests (id, org_id) on delete cascade,
  unique (request_id, role),
  unique (request_id, documenso_recipient_id)
);

create trigger signature_request_signers_set_updated_at
  before update on public.signature_request_signers
  for each row execute function private.set_updated_at();
create trigger signature_request_signers_audit
  after insert or update or delete on public.signature_request_signers
  for each row execute function private.audit_trigger('email', 'name');

alter table public.signature_request_signers enable row level security;
revoke all on public.signature_request_signers from anon, authenticated, service_role;
-- Every column but `email` (header): an address is for Documenso, never shown to a client.
grant select (id, request_id, org_id, role, name, signing_order, documenso_recipient_id, status, viewed_at,
              signed_at, rejected_at, created_at, updated_at)
  on public.signature_request_signers to authenticated;
-- Through the request: (request_id, role) then the request's primary key.
create policy signature_request_signers_select on public.signature_request_signers
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and exists (select 1 from public.signature_requests r
                 where r.id = request_id
                   and r.view_permission = any ((select private.current_permission_keys())::text[]))
  );

-- -----------------------------------------------------------------------------
-- Settings RPC (« Signature électronique », Task 3.34)
-- -----------------------------------------------------------------------------
-- Changes the signing settings of the caller's org, field by field (P3-34): `p` is a patch, an
-- object with `base_url` and/or `expiry_days`; a field left out keeps its stored value, so each
-- card sends only its own field. `base_url` is trimmed and stored without trailing slashes; an
-- empty string or null clears it. `expiry_days` is a whole number (null → 23514 « obligatoire »).
-- Another key, or no key → 22023; a value the checks refuse → 23514 (the form mirrors them).
-- When the origin (scheme, host, port) of the address changes, the `documenso_api_key` org secret
-- is deleted in the same transaction: a key is only ever sent to the address it was typed for.
-- Returns `{"api_key_cleared": bool}` (true when a stored key was deleted).
create function public.set_signing_settings(p jsonb)
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

-- -----------------------------------------------------------------------------
-- Template admin RPCs (templates: settings.manage; versions: the template's edit_permission,
-- legacy A5)
-- -----------------------------------------------------------------------------
-- A template of the caller's org (header): the caller holds settings.manage and p_edit_permission
-- (else the template would be one she cannot edit), and both permissions belong to p_module_key.
-- Its first version comes from create_template_version.
create function public.create_document_template(
  p_key text,
  p_module_key text,
  p_title text,
  p_description text,
  p_view_permission text,
  p_edit_permission text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := pg_catalog.btrim(p_title, E' \t\r\n');
  v_description text := nullif(pg_catalog.btrim(p_description, E' \t\r\n'), '');
  v_id uuid;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  if not private.has_permission(p_edit_permission) then
    raise exception 'Permission refusée : %', p_edit_permission using errcode = '42501';
  end if;
  if not exists (select 1 from public.permissions p where p.key = p_view_permission and p.module_key = p_module_key)
     or not exists (select 1 from public.permissions p where p.key = p_edit_permission and p.module_key = p_module_key) then
    raise exception 'The template permissions must belong to module %', p_module_key using errcode = '22023';
  end if;
  if coalesce(v_title, '') = '' then
    raise exception 'Le titre est obligatoire.' using errcode = 'P0001';
  end if;
  if pg_catalog.length(v_title) > 200 then
    raise exception 'Le titre ne peut pas dépasser 200 caractères.' using errcode = 'P0001';
  end if;
  if pg_catalog.length(v_description) > 1000 then
    raise exception 'La description ne peut pas dépasser 1 000 caractères.' using errcode = 'P0001';
  end if;

  insert into public.document_templates as t
    (org_id, key, module_key, title, description, view_permission, edit_permission, created_by)
  values
    (private.current_user_org_id(), p_key, p_module_key, v_title, v_description, p_view_permission,
     p_edit_permission, auth.uid())
  on conflict (org_id, key) do nothing
  returning t.id into v_id;
  if v_id is null then
    raise exception 'Un modèle avec cette clé existe déjà.' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

-- Retires a template (nothing can be sent from it: get_signing_context and
-- create_signature_request require an active one) or brings it back. settings.manage, like
-- creating it. Its versions are untouched.
create function public.set_document_template_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'p_active is required' using errcode = '22023';
  end if;
  update public.document_templates t
     set is_active = p_active
   where t.id = p_id and t.org_id = private.current_user_org_id()
     and t.is_active is distinct from p_active;
  if not found and not exists (select 1 from public.document_templates t
                                where t.id = p_id and t.org_id = private.current_user_org_id()) then
    raise exception 'Unknown template' using errcode = '22023';
  end if;
end;
$$;

-- A new draft: a copy of the published version, else an empty one. The template's row lock
-- serialises version numbers and the one-draft rule.
create function public.create_template_version(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.document_templates%rowtype;
  v_id uuid;
begin
  select * into v_template from public.document_templates t
   where t.id = p_template_id and t.org_id = private.current_user_org_id()
     for no key update;
  if not found then
    raise exception 'Unknown template' using errcode = '22023';
  end if;
  if not private.has_permission(v_template.edit_permission) then
    raise exception 'Permission refusée : %', v_template.edit_permission using errcode = '42501';
  end if;
  if exists (select 1 from public.document_template_versions v
              where v.template_id = v_template.id and v.status = 'draft') then
    raise exception 'Une version brouillon existe déjà.' using errcode = 'P0001';
  end if;

  insert into public.document_template_versions as n
    (template_id, org_id, version, body, variables, signers, email_subject, email_message, created_by)
  select v_template.id, v_template.org_id,
         coalesce((select pg_catalog.max(v.version) from public.document_template_versions v
                    where v.template_id = v_template.id), 0) + 1,
         coalesce(p.body, '{}'), coalesce(p.variables, '[]'), coalesce(p.signers, '[]'),
         coalesce(p.email_subject, ''), coalesce(p.email_message, ''), auth.uid()
    from (select 1) one
    left join public.document_template_versions p on p.template_id = v_template.id and p.status = 'published'
  returning n.id into v_id;
  return v_id;
end;
$$;

-- Saves a draft. Structure errors are 22023 (the editor builds these values); what a person can
-- cause is a French P0001: size, subject and message limits, and the placeholder rule over every
-- string of the body plus the subject and the message (header).
create function public.update_template_version(
  p_id uuid,
  p_body jsonb,
  p_variables jsonb,
  p_signers jsonb,
  p_email_subject text,
  p_email_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.document_template_versions%rowtype;
  v_edit text;
  v_subject text := coalesce(pg_catalog.btrim(p_email_subject, E' \t\r\n'), '');
  v_message text := coalesce(pg_catalog.btrim(p_email_message, E' \t\r\n'), '');
  v_error text;
begin
  select * into v_version from public.document_template_versions v
   where v.id = p_id and v.org_id = private.current_user_org_id()
     for no key update;
  if not found then
    raise exception 'Unknown template version' using errcode = '22023';
  end if;
  select t.edit_permission into v_edit from public.document_templates t where t.id = v_version.template_id;
  if not private.has_permission(v_edit) then
    raise exception 'Permission refusée : %', v_edit using errcode = '42501';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'Seule une version brouillon peut être modifiée.' using errcode = 'P0001';
  end if;

  if pg_catalog.jsonb_typeof(p_body) is distinct from 'object'
     or not private.email_variables_valid(p_variables)
     or not private.signing_signers_valid(p_signers) then
    raise exception 'Invalid body, variables or signers' using errcode = '22023';
  end if;
  if pg_catalog.pg_column_size(p_body) > 262144 then
    raise exception 'Le modèle dépasse la taille permise (256 Ko).' using errcode = 'P0001';
  end if;
  if pg_catalog.length(v_subject) > 200 then
    raise exception 'L''objet du courriel de signature ne peut pas dépasser 200 caractères.' using errcode = 'P0001';
  end if;
  if v_subject ~ '[\r\n]' then
    raise exception 'L''objet du courriel de signature doit tenir sur une seule ligne.' using errcode = 'P0001';
  end if;
  if pg_catalog.length(v_message) > 5000 then
    raise exception 'Le message du courriel de signature ne peut pas dépasser 5 000 caractères.' using errcode = 'P0001';
  end if;
  -- Every string of the body, in document order, then the subject and the message, joined by
  -- line breaks (which no placeholder may cross).
  select private.email_placeholder_error(
           coalesce(pg_catalog.string_agg(s.value #>> '{}', E'\n' order by s.ord), '')
             || E'\n' || v_subject || E'\n' || v_message,
           private.email_variable_paths(p_variables))
    into v_error
    from pg_catalog.jsonb_path_query(p_body, 'strict $.** ? (@.type() == "string")') with ordinality as s(value, ord);
  if v_error is not null then
    raise exception '%', v_error using errcode = 'P0001';
  end if;

  update public.document_template_versions v
     set body = p_body,
         variables = p_variables,
         signers = p_signers,
         email_subject = v_subject,
         email_message = v_message
   where v.id = v_version.id;
end;
$$;

-- Publishes a draft: what the fixed signing fields need must hold (header), then the previous
-- published version is archived before this one is published (the partial unique index), under
-- the template's row lock.
create function public.publish_template_version(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.document_templates%rowtype;
  v_version public.document_template_versions%rowtype;
  v_page jsonb;
begin
  select t.* into v_template
    from public.document_template_versions v
    join public.document_templates t on t.id = v.template_id
   where v.id = p_id and v.org_id = private.current_user_org_id()
     for no key update of t;
  if not found then
    raise exception 'Unknown template version' using errcode = '22023';
  end if;
  if not private.has_permission(v_template.edit_permission) then
    raise exception 'Permission refusée : %', v_template.edit_permission using errcode = '42501';
  end if;
  select * into v_version from public.document_template_versions v where v.id = p_id for no key update;
  if v_version.status <> 'draft' then
    raise exception 'Seule une version brouillon peut être publiée.' using errcode = 'P0001';
  end if;

  -- What the renderer requires (model.ts): a title, a footer, known block types (structure:
  -- 22023, the editor builds them), one signature page, last; unique roles on it; initials only
  -- by those roles.
  if pg_catalog.jsonb_typeof(v_version.body -> 'title') is distinct from 'string'
     or pg_catalog.btrim(v_version.body ->> 'title') = '' then
    raise exception 'Le modèle doit avoir un titre.' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_typeof(v_version.body -> 'footer') is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_version.body -> 'footer' -> 'text') is distinct from 'string' then
    raise exception 'Le modèle doit avoir un pied de page.' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_typeof(v_version.body -> 'blocks') = 'array'
     and exists (select 1 from pg_catalog.jsonb_array_elements(v_version.body -> 'blocks') b
                  where (b ->> 'type') is null
                     or (b ->> 'type') not in ('heading', 'paragraph', 'list', 'table', 'image', 'pageBreak',
                                               'signaturePage')) then
    raise exception 'Unknown block type' using errcode = '22023';
  end if;
  v_page := case when pg_catalog.jsonb_typeof(v_version.body -> 'blocks') = 'array'
                 then v_version.body -> 'blocks' -> -1 end;
  if v_page ->> 'type' is distinct from 'signaturePage'
     or pg_catalog.jsonb_typeof(v_page -> 'signers') is distinct from 'array'
     or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_version.body -> 'blocks') b
          where b ->> 'type' = 'signaturePage') <> 1 then
    raise exception 'Le modèle doit se terminer par une page de signature.' using errcode = 'P0001';
  end if;
  if (select pg_catalog.count(distinct s ->> 'role') <> pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(v_page -> 'signers') s) then
    raise exception 'Chaque signataire ne figure qu''une fois sur la page de signature.' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_array_length(v_version.signers) = 0 then
    raise exception 'Le modèle doit avoir au moins un signataire.' using errcode = 'P0001';
  end if;
  if (v_version.body -> 'header' -> 'initialsFor') is not null
     and (pg_catalog.jsonb_typeof(v_version.body -> 'header' -> 'initialsFor') <> 'array'
          or exists (select 1 from pg_catalog.jsonb_array_elements(v_version.body -> 'header' -> 'initialsFor') i
                      where not exists (select 1 from pg_catalog.jsonb_array_elements(v_page -> 'signers') s
                                         where s -> 'role' = i))) then
    raise exception 'Seuls les signataires du modèle peuvent parapher les pages.' using errcode = 'P0001';
  end if;
  if (select pg_catalog.array_agg(distinct s ->> 'role' order by s ->> 'role')
        from pg_catalog.jsonb_array_elements(v_page -> 'signers') s)
     is distinct from
     (select pg_catalog.array_agg(distinct s ->> 'role' order by s ->> 'role')
        from pg_catalog.jsonb_array_elements(v_version.signers) s) then
    raise exception 'Les signataires du modèle et ceux de la page de signature doivent être les mêmes.' using errcode = 'P0001';
  end if;
  if v_version.email_subject = '' then
    raise exception 'L''objet du courriel de signature est obligatoire.' using errcode = 'P0001';
  end if;

  update public.document_template_versions v
     set status = 'archived', archived_at = pg_catalog.now()
   where v.template_id = v_template.id and v.status = 'published';
  update public.document_template_versions v
     set status = 'published', published_at = pg_catalog.now(), published_by = auth.uid()
   where v.id = p_id;
end;
$$;

-- Archives a published version (nothing can be sent until another is published) or discards a
-- draft.
create function public.archive_template_version(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.document_template_versions%rowtype;
  v_edit text;
begin
  select * into v_version from public.document_template_versions v
   where v.id = p_id and v.org_id = private.current_user_org_id()
     for no key update;
  if not found then
    raise exception 'Unknown template version' using errcode = '22023';
  end if;
  select t.edit_permission into v_edit from public.document_templates t where t.id = v_version.template_id;
  if not private.has_permission(v_edit) then
    raise exception 'Permission refusée : %', v_edit using errcode = '42501';
  end if;
  if v_version.status = 'archived' then
    raise exception 'Cette version est déjà archivée.' using errcode = 'P0001';
  end if;
  update public.document_template_versions v
     set status = 'archived', archived_at = pg_catalog.now()
   where v.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- User reads (security invoker: RLS applies)
-- -----------------------------------------------------------------------------
-- The templates the caller may see (optionally one module's), with their published and draft
-- versions and whether the caller may edit them. A clinic has a handful: no paging.
create function public.list_document_templates(p_module_key text default null)
returns table (
  id uuid,
  key text,
  module_key text,
  title text,
  description text,
  view_permission text,
  edit_permission text,
  is_active boolean,
  can_edit boolean,
  published_version_id uuid,
  published_version int,
  published_at timestamptz,
  draft_version_id uuid,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.key, t.module_key, t.title, t.description, t.view_permission, t.edit_permission, t.is_active,
         t.edit_permission = any ((select private.current_permission_keys())::text[]),
         p.id, p.version, p.published_at, d.id, t.updated_at
    from public.document_templates t
    left join public.document_template_versions p on p.template_id = t.id and p.status = 'published'
    left join public.document_template_versions d on d.template_id = t.id and d.status = 'draft'
   where t.org_id = (select private.current_user_org_id())
     and (p_module_key is null or t.module_key = p_module_key)
   order by t.key
$$;

-- A record's requests (« Historique », the contract card, P3-26), newest first, keyset-paged on
-- (created_at, id): pass the last row's created_at and id. Signers carry their role, name and
-- progress, never an address. As list_email_log, the cursor is folded into variables first so it
-- stays an index bound of signature_requests_subject_idx in a generic plan.
create function public.list_subject_signature_requests(
  p_subject_type text,
  p_subject_id uuid,
  p_limit int default 50,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  module_key text,
  purpose text,
  title text,
  status text,
  template_version_id uuid,
  template_version int,
  sent_by uuid,
  created_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  expires_at timestamptz,
  rejection_reason text,
  last_error text,
  signed_file_id uuid,
  signers jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_before timestamptz := coalesce(p_before, 'infinity');
  v_before_id uuid := coalesce(p_before_id,
                               case when p_before is null then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
                                    else '00000000-0000-0000-0000-000000000000'::uuid end);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  return query
  select r.id, r.module_key, r.purpose, r.title, r.status, r.template_version_id, v.version, r.sent_by,
         r.created_at, r.sent_at, r.viewed_at, r.completed_at, r.rejected_at, r.cancelled_at, r.expired_at,
         r.expires_at, r.rejection_reason, r.last_error, r.signed_file_id,
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'role', s.role, 'name', s.name, 'status', s.status, 'signing_order', s.signing_order,
                            'viewed_at', s.viewed_at, 'signed_at', s.signed_at, 'rejected_at', s.rejected_at)
                          order by s.signing_order)
                     from public.signature_request_signers s where s.request_id = r.id), '[]')
    from public.signature_requests r
    left join public.document_template_versions v on v.id = r.template_version_id
   where r.org_id = (select private.current_user_org_id())
     and r.subject_type = p_subject_type
     and r.subject_id = p_subject_id
     and (r.created_at, r.id) < (v_before, v_before_id)
   order by r.created_at desc, r.id desc
   limit v_limit;
end;
$$;

-- One request the caller may see, or none (signing-sync in user mode).
create function public.get_signature_request(p_id uuid)
returns table (
  id uuid,
  org_id uuid,
  module_key text,
  purpose text,
  subject_type text,
  subject_id uuid,
  title text,
  status text,
  documenso_document_id text,
  envelope_id text,
  expires_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  last_error text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.org_id, r.module_key, r.purpose, r.subject_type, r.subject_id, r.title, r.status,
         r.documenso_document_id, r.envelope_id, r.expires_at, r.sent_at, r.completed_at, r.last_error
    from public.signature_requests r
   where r.id = p_id
$$;

revoke all on function
  public.set_signing_settings(jsonb),
  public.create_document_template(text, text, text, text, text, text),
  public.set_document_template_active(uuid, boolean),
  public.create_template_version(uuid),
  public.update_template_version(uuid, jsonb, jsonb, jsonb, text, text),
  public.publish_template_version(uuid),
  public.archive_template_version(uuid),
  public.list_document_templates(text),
  public.list_subject_signature_requests(text, uuid, int, timestamptz, uuid),
  public.get_signature_request(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.set_signing_settings(jsonb),
  public.create_document_template(text, text, text, text, text, text),
  public.set_document_template_active(uuid, boolean),
  public.create_template_version(uuid),
  public.update_template_version(uuid, jsonb, jsonb, jsonb, text, text),
  public.publish_template_version(uuid),
  public.archive_template_version(uuid),
  public.list_document_templates(text),
  public.list_subject_signature_requests(text, uuid, int, timestamptz, uuid),
  public.get_signature_request(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- Service-role RPCs (supabase/functions/_shared/signing.ts, signing-webhook, signing-sync)
-- -----------------------------------------------------------------------------
-- Everything one send needs, in one round trip: the published version (null for the built-in
-- test document), the settings, the clinic identity and signatory, the timezone, the module's
-- state, and the logo and signature images as {file_id, bucket, object_path} (ready files only,
-- else null; read by _shared/pdf/assets.ts loadAssets). 22023 for an unknown org, or a version
-- that is not published, active and of that org.
create function public.get_signing_context(p_org_id uuid, p_template_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version jsonb;
  v_module text := 'core';
  v_context jsonb;
begin
  if p_template_version_id is not null then
    select pg_catalog.jsonb_build_object(
             'id', v.id, 'template_id', t.id, 'template_key', t.key, 'version', v.version,
             'view_permission', t.view_permission, 'body', v.body, 'variables', v.variables,
             'signers', v.signers, 'email_subject', v.email_subject, 'email_message', v.email_message),
           t.module_key
      into v_version, v_module
      from public.document_template_versions v
      join public.document_templates t on t.id = v.template_id
     where v.id = p_template_version_id and v.org_id = p_org_id and v.status = 'published' and t.is_active;
    if v_version is null then
      raise exception 'No published template version % in the organization', p_template_version_id using errcode = '22023';
    end if;
  end if;

  select pg_catalog.jsonb_build_object(
           'module_key', v_module,
           'module_enabled', public.module_enabled_for_org(o.id, v_module),
           'timezone', o.timezone,
           'settings', pg_catalog.jsonb_build_object('base_url', s.base_url, 'expiry_days', s.expiry_days),
           'version', v_version,
           'clinic', pg_catalog.jsonb_build_object(
             'name', o.name,
             'legal_name', o.legal_name,
             'address_line1', o.address_line1,
             'address_line2', o.address_line2,
             'city', o.city,
             'province', o.province,
             'postal_code', o.postal_code,
             'phone', o.phone,
             'email', o.email,
             'website', o.website,
             'signatory_name', o.signatory_name,
             'signatory_title', o.signatory_title,
             'signatory_email', o.signatory_email),
           'logo', (select pg_catalog.jsonb_build_object('file_id', f.id, 'bucket', f.bucket, 'object_path', f.object_path)
                      from public.stored_files f where f.id = o.logo_file_id and f.status = 'ready'),
           'signature', (select pg_catalog.jsonb_build_object('file_id', f.id, 'bucket', f.bucket, 'object_path', f.object_path)
                           from public.stored_files f where f.id = o.signature_file_id and f.status = 'ready'))
    into v_context
    from public.organizations o
    join public.signing_settings s on s.org_id = o.id
   where o.id = p_org_id;
  if v_context is null then
    raise exception 'Unknown organization' using errcode = '22023';
  end if;
  return v_context;
end;
$$;

-- Inserts a request (`draft`) and its signers, idempotent on (org_id, idempotency_key): the same
-- key returns its existing row (`existing` = true), whatever its status and the other fields,
-- provided its signers are the same (role, order, name, and address ignoring case and outer
-- spaces): other signers → P0001 « Les signataires ne correspondent pas à la demande
-- existante. » (the same key is the same action; and the stored signing orders stay the ones a
-- re-send gives Documenso, which recovering a completed draft relies on). Both paths return the
-- row's status, its signers ([{role, signer_id}] in signing order: the recipients of
-- mark_signature_request_sent are keyed by role), last_error, created_at and the Documenso
-- document and envelope ids (a draft's earlier document, which a re-send settles first). A send
-- claims the draft with begin_signature_request_send before rendering.
-- p: {org_id, module_key, purpose, template_version_id (null only for core.signing_test),
-- subject_type, subject_id, title, view_permission, idempotency_key, sent_by (null for the
-- system), signers: [{role, name, email, order}]}. Refused (22023): a disabled module, a purpose
-- or view permission outside the module, a version not published (or of an inactive template,
-- another module or org), signers not matching the version (each role one of the version's,
-- every required one present, one order each), a sender outside the org. Two signers with one
-- address: P0001 (Documenso reads recipients back by address). A new key while the record has an
-- open request of this purpose (header): P0001, until cancel_signature_request closes it.
create function public.create_signature_request(p jsonb)
returns table (id uuid, existing boolean, status text, signers jsonb, last_error text, created_at timestamptz,
               documenso_document_id text, envelope_id text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_module text := p ->> 'module_key';
  v_purpose text := p ->> 'purpose';
  v_version uuid := (p ->> 'template_version_id')::uuid;
  v_view text := p ->> 'view_permission';
  v_key text := p ->> 'idempotency_key';
  v_sent_by uuid := (p ->> 'sent_by')::uuid;
  v_subject_type text := p ->> 'subject_type';
  v_subject_id uuid := (p ->> 'subject_id')::uuid;
  v_signers jsonb := p -> 'signers';
  v_roles jsonb;
  v_id uuid;
  v_new boolean := false;
begin
  if v_org is null or v_module is null or v_key is null
     or not exists (select 1 from public.organizations o where o.id = v_org) then
    raise exception 'Unknown organization, or no module or idempotency key' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(v_org, v_module) then
    raise exception 'Module disabled for the organization' using errcode = '22023';
  end if;
  if v_purpose is null or pg_catalog.split_part(v_purpose, '.', 1) <> v_module
     or not exists (select 1 from public.permissions pm where pm.key = v_view and pm.module_key = v_module) then
    raise exception 'The purpose and the view permission must belong to module %', v_module using errcode = '22023';
  end if;
  if v_version is null then
    if v_purpose <> 'core.signing_test' then
      raise exception 'Only the built-in test document has no template version' using errcode = '22023';
    end if;
  else
    select v.signers into v_roles
      from public.document_template_versions v
      join public.document_templates t on t.id = v.template_id
     where v.id = v_version and v.org_id = v_org and v.status = 'published' and t.is_active and t.module_key = v_module;
    if not found then
      raise exception 'No published template version % of module % in the organization', v_version, v_module
        using errcode = '22023';
    end if;
  end if;
  if v_sent_by is not null
     and not exists (select 1 from public.profiles pr where pr.user_id = v_sent_by and pr.org_id = v_org) then
    raise exception 'The sender is not a member of the organization' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(v_signers) is distinct from 'array'
     or pg_catalog.jsonb_array_length(v_signers) not between 1 and 3
     or exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                 where case when pg_catalog.jsonb_typeof(s) <> 'object' then true
                            else (s ->> 'role') is null
                              or (s ->> 'role') not in ('professional', 'clinic', 'client')
                              or coalesce(pg_catalog.length(pg_catalog.btrim(s ->> 'name')), 0) not between 1 and 200
                              or (s ->> 'name') ~ '[[:cntrl:]]'
                              or not coalesce(private.is_mailbox(pg_catalog.btrim(s ->> 'email')), false)
                              or pg_catalog.jsonb_typeof(s -> 'order') is distinct from 'number'
                              or (s ->> 'order') !~ '^[1-9]$'
                       end)
     or (select pg_catalog.count(distinct s ->> 'role') <> pg_catalog.count(*)
                or pg_catalog.count(distinct s ->> 'order') <> pg_catalog.count(*)
           from pg_catalog.jsonb_array_elements(v_signers) s) then
    raise exception 'Invalid signers' using errcode = '22023';
  end if;
  if v_roles is not null
     and (exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                   where not exists (select 1 from pg_catalog.jsonb_array_elements(v_roles) r
                                      where r ->> 'role' = s ->> 'role'))
          or exists (select 1 from pg_catalog.jsonb_array_elements(v_roles) r
                      where (r ->> 'required')::boolean
                        and not exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                                         where s ->> 'role' = r ->> 'role'))) then
    raise exception 'The signers must match the roles of the template version' using errcode = '22023';
  end if;
  if (select pg_catalog.count(distinct pg_catalog.lower(pg_catalog.btrim(s ->> 'email')))
        from pg_catalog.jsonb_array_elements(v_signers) s) <> pg_catalog.jsonb_array_length(v_signers) then
    raise exception 'Chaque signataire doit avoir sa propre adresse courriel.' using errcode = 'P0001';
  end if;

  -- The idempotency key first: the same key always returns its own row (header).
  select r.id into v_id from public.signature_requests r where r.org_id = v_org and r.idempotency_key = v_key;
  if v_id is null then
    if v_purpose <> 'core.signing_test'
       and exists (select 1 from public.signature_requests r
                    where r.org_id = v_org and r.subject_type = v_subject_type and r.subject_id = v_subject_id
                      and r.purpose = v_purpose
                      and (r.status in ('sent', 'viewed')
                           or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))) then
      raise exception 'Une demande de signature est déjà en cours pour ce dossier.' using errcode = 'P0001';
    end if;
    begin
      insert into public.signature_requests as r
        (org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, idempotency_key,
         view_permission, sent_by)
      values
        (v_org, v_module, v_purpose, v_version, v_subject_type, v_subject_id,
         pg_catalog.btrim(p ->> 'title', E' \t\r\n'), v_key, v_view, v_sent_by)
      on conflict (org_id, idempotency_key) do nothing
      returning r.id into v_id;
    exception when unique_violation then
      -- A concurrent request with another key for the same record and purpose won the race.
      raise exception 'Une demande de signature est déjà en cours pour ce dossier.' using errcode = 'P0001';
    end;
    if v_id is null then
      -- The same key, inserted concurrently.
      select r.id into v_id from public.signature_requests r where r.org_id = v_org and r.idempotency_key = v_key;
    else
      insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order)
      select v_id, v_org, s ->> 'role', pg_catalog.btrim(s ->> 'name'), pg_catalog.btrim(s ->> 'email'),
             (s ->> 'order')::smallint
        from pg_catalog.jsonb_array_elements(v_signers) s;
      v_new := true;
    end if;
  end if;

  -- The same key with other signers is not the same action (header).
  if not v_new
     and (exists (select s ->> 'role', (s ->> 'order')::smallint, pg_catalog.btrim(s ->> 'name'),
                         pg_catalog.lower(pg_catalog.btrim(s ->> 'email'))
                    from pg_catalog.jsonb_array_elements(v_signers) s
                  except
                  select x.role, x.signing_order, x.name, pg_catalog.lower(x.email)
                    from public.signature_request_signers x where x.request_id = v_id)
          or exists (select x.role, x.signing_order, x.name, pg_catalog.lower(x.email)
                       from public.signature_request_signers x where x.request_id = v_id
                     except
                     select s ->> 'role', (s ->> 'order')::smallint, pg_catalog.btrim(s ->> 'name'),
                            pg_catalog.lower(pg_catalog.btrim(s ->> 'email'))
                       from pg_catalog.jsonb_array_elements(v_signers) s)) then
    raise exception 'Les signataires ne correspondent pas à la demande existante.' using errcode = 'P0001';
  end if;

  return query
    select r.id, not v_new, r.status,
           coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role', s.role, 'signer_id', s.id)
                                                 order by s.signing_order)
                       from public.signature_request_signers s where s.request_id = r.id), '[]'),
           r.last_error, r.created_at, r.documenso_document_id, r.envelope_id
      from public.signature_requests r
     where r.id = v_id;
end;
$$;

-- p_ids with p_old appended when another document p_new replaces it (a re-send), the latest 20
-- kept; unchanged when nothing replaces anything.
create function private.signing_superseded(p_ids text[], p_old text, p_new text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when p_old is null or p_new is null or p_old = p_new or p_old = any (p_ids) then p_ids
              else (p_ids || p_old)[greatest(pg_catalog.cardinality(p_ids) - 18, 1):] end
$$;

-- p_recipients is one {role, recipient_id} per signer of the request: each role one of its
-- signers', the recipient ids numeric, roles and recipient ids distinct.
create function private.signing_recipients_valid(p_request_id uuid, p_recipients jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_recipients) is not distinct from 'array'
     and pg_catalog.jsonb_array_length(p_recipients)
         = (select pg_catalog.count(*) from public.signature_request_signers s where s.request_id = p_request_id)
     and not exists (select 1 from pg_catalog.jsonb_array_elements(p_recipients) e
                      where pg_catalog.jsonb_typeof(e) <> 'object'
                         or (e ->> 'recipient_id') is null
                         or (e ->> 'recipient_id') !~ '^[1-9][0-9]{0,14}$'
                         or not exists (select 1 from public.signature_request_signers s
                                         where s.request_id = p_request_id and s.role = e ->> 'role'))
     and (select pg_catalog.count(distinct e ->> 'role') = pg_catalog.count(*)
                 and pg_catalog.count(distinct e ->> 'recipient_id') = pg_catalog.count(*)
            from pg_catalog.jsonb_array_elements(p_recipients) e)
$$;
revoke all on function
  private.signing_superseded(text[], text, text),
  private.signing_recipients_valid(uuid, jsonb)
from public, anon, authenticated, service_role;

-- Claims a live draft of the org for one send (createSignatureRequest, before rendering) or one
-- settle (the reconcile, a completed draft's recovery), under the row lock, so two attempts never
-- run at once. True when it claimed: send_started_at = last_send_at = now() and last_error
-- cleared. False for a request that is not a live draft (sent, terminal, abandoned), or whose
-- current claim is newer than now() - p_stale_after (a send under way; an older one died).
-- mark_signature_request_sent and _failed release the claim (last_send_at stays). 22023: an
-- unknown request of the org, a missing or negative staleness.
create function public.begin_signature_request_send(p_org_id uuid, p_id uuid, p_stale_after interval)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.signature_requests%rowtype;
begin
  if p_stale_after is null or p_stale_after < interval '0' then
    raise exception 'A staleness of zero or more is required' using errcode = '22023';
  end if;
  select * into v_row from public.signature_requests r where r.id = p_id and r.org_id = p_org_id for update;
  if not found then
    raise exception 'Unknown request' using errcode = '22023';
  end if;
  if v_row.status <> 'draft' or v_row.last_error is not distinct from 'abandoned'
     or v_row.send_started_at > pg_catalog.now() - p_stale_after then
    return false;
  end if;
  update public.signature_requests r
     set send_started_at = pg_catalog.now(), last_send_at = pg_catalog.now(), last_error = null
   where r.id = v_row.id;
  return true;
end;
$$;

-- Documenso accepted and distributed the document. A live draft (not abandoned) becomes `sent`
-- with its document and envelope ids, expiry and source file; each signer gets its recipient id
-- (p_signer_recipients: [{role, recipient_id}], one per signer of the request; a role is unique
-- per request, and create_signature_request returns the roles). The source file must be this
-- request's `signing_source` system file, ready, with the request's view permission; it stops
-- being staged. The send's claim is released; a re-send's earlier document joins
-- superseded_document_ids. Anything else → 22023.
create function public.mark_signature_request_sent(
  p_id uuid,
  p_documenso_document_id text,
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
  if p_documenso_document_id is null or p_documenso_document_id !~ '^[1-9][0-9]{0,14}$'
     or (p_envelope_id is not null and p_envelope_id !~ '^envelope_[A-Za-z0-9_-]{1,64}$')
     or p_expires_at is null or p_expires_at <= pg_catalog.now() then
    raise exception 'Invalid document id, envelope id or expiry' using errcode = '22023';
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
         superseded_document_ids = private.signing_superseded(r.superseded_document_ids, r.documenso_document_id,
                                                              p_documenso_document_id),
         documenso_document_id = p_documenso_document_id,
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
-- the error code and, when given, the Documenso document and envelope it created (a re-send's
-- earlier document joins superseded_document_ids), and the send's claim is released, so « Renvoyer »
-- may try again at once. A late call on an abandoned draft (a send that ends after the reconcile
-- or cancel_signature_request closed it) records the ids only: the draft stays abandoned.
create function public.mark_signature_request_failed(
  p_id uuid,
  p_error_code text,
  p_documenso_document_id text default null,
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
     or (p_documenso_document_id is not null and p_documenso_document_id !~ '^[1-9][0-9]{0,14}$')
     or (p_envelope_id is not null and p_envelope_id !~ '^envelope_[A-Za-z0-9_-]{1,64}$') then
    raise exception 'Invalid error code, document id or envelope id' using errcode = '22023';
  end if;
  update public.signature_requests r
     set last_error = case when r.last_error = 'abandoned' then r.last_error else p_error_code end,
         superseded_document_ids = private.signing_superseded(r.superseded_document_ids, r.documenso_document_id,
                                                              p_documenso_document_id),
         documenso_document_id = coalesce(p_documenso_document_id, r.documenso_document_id),
         envelope_id = case when p_documenso_document_id is not null then p_envelope_id
                            else coalesce(p_envelope_id, r.envelope_id) end,
         send_started_at = null
   where r.id = p_id and r.status = 'draft';
  if not found then
    raise exception 'Unknown request, or not a draft' using errcode = '22023';
  end if;
end;
$$;

-- Applies a Documenso event (signing-webhook, signing-sync) under Documenso's raw event names.
-- The row is found by id (the document's externalId) within p_org_id, else by document id
-- within p_org_id. Returns `not_found` (no row in the org, or a sent or closed request whose
-- document id is another one, neither current nor superseded), `ignored` (a superseded document
-- of the request: a re-send cancelled it; a disabled module, an abandoned draft, a terminal
-- request, an unknown event, or nothing to change), `retry` (a draft not abandoned whose
-- Documenso document exists: a send under way or failed part way, whose document may be a
-- re-send's new one not recorded yet; the webhook answers 409 so Documenso retries, and the
-- reconcile settles a failed one) or `applied`. Transitions (monotonic, header):
--   DOCUMENT_OPENED            the recipient pending → viewed; the request sent → viewed
--   DOCUMENT_SIGNED,
--   DOCUMENT_RECIPIENT_COMPLETED  the recipient → signed (and viewed); the request sent → viewed
--   DOCUMENT_COMPLETED         every signer → signed; completed_event_at stamped; needs_download
--                              (complete_signature_request then stores the signed PDF and sets
--                              `signed`)
--   DOCUMENT_REJECTED          the request → rejected with the reason (control characters
--                              removed, cut to 500); the recipient → rejected
--   DOCUMENT_CANCELLED         the request → cancelled
-- After DOCUMENT_COMPLETED, a rejection or cancellation is ignored (header).
-- p_at (the provider's time, at most now) stamps the change.
create function public.apply_signing_event(
  p_org_id uuid,
  p_request_id uuid,
  p_documenso_document_id text,
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
  if p_org_id is null or p_event is null then
    raise exception 'Organization and event are required' using errcode = '22023';
  end if;

  if p_request_id is not null then
    select * into v_row from public.signature_requests r
     where r.id = p_request_id and r.org_id = p_org_id
       for update;
  end if;
  if v_row.id is null and p_documenso_document_id is not null then
    select * into v_row from public.signature_requests r
     where r.org_id = p_org_id and r.documenso_document_id = p_documenso_document_id
       for update;
  end if;
  if v_row.id is null or (p_request_id is not null and v_row.id <> p_request_id) then
    return query select 'not_found'::text, null::uuid, null::text, false;
    return;
  end if;
  -- An earlier document a re-send cancelled: its late events are expected.
  if p_documenso_document_id = any (v_row.superseded_document_ids) then
    return query select 'ignored'::text, v_row.id, v_row.module_key, false;
    return;
  end if;
  -- A draft's send may be creating a new document (a re-send): only a request past its draft
  -- has one document id for good.
  if v_row.status <> 'draft' and p_documenso_document_id is not null
     and v_row.documenso_document_id <> p_documenso_document_id then
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
                   and coalesce(v_row.documenso_document_id, p_documenso_document_id) is not null
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

-- The signed PDF is stored: a sent or viewed request becomes `signed` with the file (this
-- request's `signing_signed` system file, ready, with the given hash and the request's view
-- permission; it stops being staged), and every signer is signed. Its expiry does not matter: a
-- request Documenso completed cannot be expired (header). Calling it again with the same file is
-- a no-op; anything else → 22023.
create function public.complete_signature_request(p_id uuid, p_signed_file_id uuid, p_signed_sha256 text)
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
  if not found then
    raise exception 'Unknown request' using errcode = '22023';
  end if;
  if v_row.status = 'signed' and v_row.signed_file_id = p_signed_file_id then
    return;
  end if;
  if v_row.status not in ('sent', 'viewed') then
    raise exception 'Only a sent or viewed request can be completed' using errcode = '22023';
  end if;

  update public.stored_files f
     set retain_until = null
   where f.id = p_signed_file_id
     and f.org_id = v_row.org_id
     and f.purpose = 'signing_signed'
     and f.status = 'ready'
     and f.uploaded_by is null
     and f.subject_type = 'signature_request'
     and f.subject_id = v_row.id
     and f.sha256 = p_signed_sha256
     and f.view_permission = v_row.view_permission
     and (f.retain_until is null or f.retain_until > pg_catalog.now());
  if not found then
    raise exception 'Invalid signed file' using errcode = '22023';
  end if;

  update public.signature_request_signers s
     set status = 'signed', signed_at = coalesce(s.signed_at, pg_catalog.now())
   where s.request_id = v_row.id and s.status in ('pending', 'viewed');
  update public.signature_requests r
     set status = 'signed', completed_at = pg_catalog.now(),
         completed_event_at = coalesce(r.completed_event_at, pg_catalog.now()),
         signed_file_id = p_signed_file_id, signed_sha256 = p_signed_sha256
   where r.id = v_row.id;
end;
$$;

-- core.signing_reconcile (signing-sync, one org at a time): the org's open requests to act on,
-- `expire` and `abandon` first, then by expiry (soonest first), with the action:
--   `expire`   sent or viewed past expires_at: sync first (read Documenso and apply its events: a
--              lost DOCUMENT_COMPLETED makes expire_signature_request refuse, and the signed PDF
--              is downloaded instead); if still not complete, expire_signature_request, then
--              cancel at Documenso;
--   `sync`     sent or viewed for over a day, or one Documenso completed whose signed PDF is not
--              stored yet (whatever its expiry): read Documenso and apply the events, download
--              when completed (a webhook may have been lost); also a draft with a Documenso
--              document whose last send started over an hour ago (last_send_at, else
--              created_at: a send lasts minutes, and a failed one keeps its last_send_at, so a
--              « Renvoyer » that just failed is not settled at once): read its status, then
--              recover it when Documenso completed it (soon, so the signed contract shows), else
--              cancel it there and mark_signature_request_failed('abandoned');
--   `abandon`  a draft with no Documenso document whose last send started over a day ago (the
--              same clock), not abandoned: mark_signature_request_failed('abandoned').
-- A draft is acted on only after begin_signature_request_send claims it (else skipped: a send
-- is under way). A disabled module's requests are skipped. Reads signature_requests_open_idx.
create function public.list_signature_requests_to_reconcile(p_org_id uuid, p_limit int default 100)
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
      select case when r.status = 'draft' then case when r.documenso_document_id is null then 'abandon' else 'sync' end
                  when r.completed_event_at is not null then 'sync'
                  when r.expires_at < pg_catalog.now() then 'expire'
                  else 'sync' end as action) a
   where r.org_id = p_org_id
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))
     and ((r.status = 'draft'
           and coalesce(r.last_send_at, r.created_at)
               < pg_catalog.now() - case when r.documenso_document_id is null then interval '1 day'
                                         else interval '1 hour' end)
          or (r.status <> 'draft'
              and (r.sent_at < pg_catalog.now() - interval '1 day' or r.expires_at < pg_catalog.now())))
     and public.module_enabled_for_org(r.org_id, r.module_key)
   order by a.action in ('expire', 'abandon') desc, r.expires_at nulls last, r.created_at, r.id
   limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

-- A sent or viewed request past its expiry becomes `expired`. True when it did; false for any
-- other request (not overdue, already terminal, or completed at Documenso: completed_event_at),
-- which is left as is.
create function public.expire_signature_request(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.signature_requests r
     set status = 'expired', expired_at = pg_catalog.now()
   where r.id = p_id and r.status in ('sent', 'viewed') and r.expires_at < pg_catalog.now()
     and r.completed_event_at is null;
  return found;
end;
$$;

-- Phase 4 (a contract replaced, a record closed): closes an open request, so a new one can be
-- created for the record (one open request per record and purpose, header). The caller cancels
-- the Documenso document first when the request has one (Documenso refuses once the document is
-- completed, and its DOCUMENT_CANCELLED webhook is then ignored as a no-op). sent or viewed →
-- `cancelled` (cancelled_at, cancelled_by = p_by); a draft → abandoned (a send under way then
-- fails at mark_signature_request_sent). True when it closed the request; false when it was
-- already closed (rejected, cancelled, expired, abandoned). Refused: a request Documenso
-- completed (signed, or completed_event_at) → P0001; an unknown request, or p_by (null: the
-- system) outside its org → 22023.
create function public.cancel_signature_request(p_id uuid, p_by uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.signature_requests%rowtype;
begin
  select * into v_row from public.signature_requests r where r.id = p_id for update;
  if not found then
    raise exception 'Unknown request' using errcode = '22023';
  end if;
  if p_by is not null
     and not exists (select 1 from public.profiles pr where pr.user_id = p_by and pr.org_id = v_row.org_id) then
    raise exception 'The canceller is not a member of the organization' using errcode = '22023';
  end if;
  if v_row.status = 'signed' or v_row.completed_event_at is not null then
    raise exception 'Ce document a déjà été signé : la demande ne peut plus être annulée.' using errcode = 'P0001';
  end if;
  if v_row.status in ('sent', 'viewed') then
    update public.signature_requests r
       set status = 'cancelled', cancelled_at = pg_catalog.now(), cancelled_by = p_by
     where r.id = v_row.id;
    return true;
  end if;
  if v_row.status = 'draft' and coalesce(v_row.last_error, '') <> 'abandoned' then
    update public.signature_requests r
       set last_error = 'abandoned', cancelled_by = p_by
     where r.id = v_row.id;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function
  public.get_signing_context(uuid, uuid),
  public.create_signature_request(jsonb),
  public.begin_signature_request_send(uuid, uuid, interval),
  public.mark_signature_request_sent(uuid, text, text, uuid, jsonb, timestamptz),
  public.mark_signature_request_failed(uuid, text, text, text),
  public.apply_signing_event(uuid, uuid, text, text, text, timestamptz, text),
  public.complete_signature_request(uuid, uuid, text),
  public.list_signature_requests_to_reconcile(uuid, int),
  public.expire_signature_request(uuid),
  public.cancel_signature_request(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.get_signing_context(uuid, uuid),
  public.create_signature_request(jsonb),
  public.begin_signature_request_send(uuid, uuid, interval),
  public.mark_signature_request_sent(uuid, text, text, uuid, jsonb, timestamptz),
  public.mark_signature_request_failed(uuid, text, text, text),
  public.apply_signing_event(uuid, uuid, text, text, text, timestamptz, text),
  public.complete_signature_request(uuid, uuid, text),
  public.list_signature_requests_to_reconcile(uuid, int),
  public.expire_signature_request(uuid),
  public.cancel_signature_request(uuid, uuid)
to service_role;

-- -----------------------------------------------------------------------------
-- Upload purposes (register_system_file) and the reconcile job
-- -----------------------------------------------------------------------------
-- System files only (no client uploads them: settings.integrations_manage is just the strictest
-- core key). Each file takes the request's view permission; staged one day until the request
-- takes it (header).
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('signing_source', 'core', 'documents', 'settings.integrations_manage', 'settings.integrations_manage', null,
   10485760, array['application/pdf'], null, 1),
  ('signing_signed', 'core', 'signed-documents', 'settings.integrations_manage', 'settings.integrations_manage', null,
   20971520, array['application/pdf'], null, 1)
on conflict do nothing;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, cron_job_name, is_maintenance)
values
  ('core.signing_reconcile', 'core', 'Suivi des signatures électroniques',
   'Met à jour les demandes de signature restées sans nouvelles depuis plus d''un jour, annule celles qui ont expiré et nettoie les envois qui n''ont pas abouti.',
   'function', 'signing-sync', 'core.signing_reconcile', true)
on conflict do nothing;

select cron.schedule('core.signing_reconcile', '50 8 * * *',
  $$select private.invoke_job_function('core.signing_reconcile')$$);
