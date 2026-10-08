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
-- * Versions (design §6.2, legacy A5): `draft → published → archived`, or a draft discarded
--   straight to `archived`. At most one draft and one published version per template (partial
--   unique indexes); publishing archives the previous one first, under the template's row lock.
--   Only a draft changes: the trigger `document_template_versions_guard` refuses any change to a
--   published or archived version's content, and any status move backwards, whoever writes the
--   row. A request only references a published version, so a version is immutable once used.
-- * Bodies are the renderer's `PdfDocument` (supabase/functions/_shared/pdf/model.ts), validated
--   in full by the renderer (`checkDocument`). Here: an object of at most 256 KB; every string
--   in it, plus the Documenso email subject and message, uses only declared placeholders (the
--   email rule, `private.email_placeholder_error`, Task 3.30: the renderer fills every string).
--   Publishing also requires what the fixed signing fields rely on: the body ends with a
--   `signaturePage`, whose roles are exactly the version's signers, and an email subject.
-- * Requests (design §6.2): `draft` between the insert and Documenso's success (inconsistency
--   #11), then `sent → viewed → signed | rejected | cancelled | expired`. Transitions are
--   monotonic and come from Documenso (apply_signing_event: the webhook, and signing-sync for a
--   lost one); a terminal state never moves; a draft ignores events (reconcile handles it). Per
--   signer: `pending → viewed → signed | rejected`. `last_error` is a code; a failed draft keeps
--   the Documenso document it created (and its envelope id) so the reconcile can cancel it.
--   `DOCUMENT_COMPLETED` answers needs_download (the webhook stores the signed PDF and calls
--   complete_signature_request); the request becomes `signed` only with that file.
-- * Files: the unsigned and signed PDFs are registered by the function (register_system_file,
--   purposes `signing_source` and `signing_signed`), staged one day (P3-17). mark_..._sent and
--   complete_signature_request take them (clear `retain_until`); a file left behind by a failed
--   or retried step is purged by storage-cleanup. Paths follow Task 3.24 (`{org}/core/{request
--   id}/{file id}.pdf`), so a retried download registers a new file instead of overwriting.
-- * Personal data: signer addresses and names are redacted from the audit log (the timeline
--   shows roles), and so is a rejection reason (free text from the signer). Template bodies are
--   redacted too: a version's row is its own record, and bodies are up to 256 KB. Nothing here
--   stores a signing token or link.
-- * Reads: list_document_templates, list_subject_signature_requests (P3-26, keyset-paged on
--   (created_at, id)) and get_signature_request are security invoker, so RLS applies.
-- * Deviations from the plan:
--   - list_signature_requests_to_reconcile(p_org_id, p_limit) works per org, like storage-cleanup
--     (runJob runs one org at a time), returns the action to take (`sync`, `expire`, `abandon`)
--     and skips a disabled module's requests. One partial index of the open requests per org
--     replaces `(status, sent_at) where status in ('sent','viewed')`; abandoned drafts leave it.
--   - `documenso_document_id` is unique per org, not globally: ids are per Documenso instance,
--     and each org configures its own instance.
--   - create_signature_request also returns the row's status; mark_signature_request_sent takes
--     the envelope id; mark_signature_request_failed optionally records the document and
--     envelope ids; list_subject_signature_requests takes p_limit, p_before, p_before_id.
--   - `expired_at` and `archived_at` record those transitions.
--   - `base_url` also refuses whitespace, `?` and `#`; set_signing_settings trims the value and
--     its trailing slashes.
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
create table public.signing_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- The clinic's Documenso instance. The second form is the local fake only
  -- (`npm run fake:documenso`, P3-23, P3-30): host.docker.internal resolves on dev machines only.
  base_url text check (
    pg_catalog.length(base_url) <= 2048
    and (base_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?(/[^[:space:]?#]*)?$'
         or base_url ~ '^http://host\.docker\.internal:[0-9]+(/[^[:space:]?#]*)?$')),
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

-- Only a draft changes; a status never moves backwards (header). Whoever writes the row.
create function private.guard_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and (new.template_id, new.org_id, new.version, new.body, new.variables, new.signers,
          new.email_subject, new.email_message)
         is distinct from
         (old.template_id, old.org_id, old.version, old.body, old.variables, old.signers,
          old.email_subject, old.email_message) then
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  viewed_at timestamptz,
  completed_at timestamptz,
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
  foreign key (sent_by, org_id) references public.profiles (user_id, org_id) on delete set null (sent_by)
);
-- A subject's requests, newest first: list_subject_signature_requests (keyset), the org FK and
-- the RLS org predicate.
create index signature_requests_subject_idx
  on public.signature_requests (org_id, subject_type, subject_id, created_at desc, id desc);
-- The open requests of an org (list_signature_requests_to_reconcile), oldest first.
create index signature_requests_open_idx on public.signature_requests (org_id, created_at)
  where status in ('sent', 'viewed') or (status = 'draft' and coalesce(last_error, '') <> 'abandoned');
create index signature_requests_module_key_idx on public.signature_requests (module_key);
create index signature_requests_template_version_id_idx on public.signature_requests (template_version_id);
create index signature_requests_view_permission_idx on public.signature_requests (view_permission);
create index signature_requests_source_file_id_idx on public.signature_requests (source_file_id) where source_file_id is not null;
create index signature_requests_signed_file_id_idx on public.signature_requests (signed_file_id) where signed_file_id is not null;
create index signature_requests_sent_by_idx on public.signature_requests (sent_by) where sent_by is not null;

create trigger signature_requests_set_updated_at
  before update on public.signature_requests
  for each row execute function private.set_updated_at();
create trigger signature_requests_audit
  after insert or update or delete on public.signature_requests
  for each row execute function private.audit_trigger('rejection_reason');

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
grant select on public.signature_request_signers to authenticated;
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
-- Sets the instance address (trimmed, without trailing slashes; empty clears it) and the expiry
-- of the caller's org. The checks raise 23514 (the form mirrors them).
create function public.set_signing_settings(p_base_url text, p_expiry_days int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('settings.integrations_manage') then
    raise exception 'Permission refusée : settings.integrations_manage' using errcode = '42501';
  end if;
  update public.signing_settings s
     set base_url = nullif(pg_catalog.rtrim(pg_catalog.btrim(p_base_url, E' \t\r\n'), '/'), ''),
         expiry_days = p_expiry_days,
         updated_by = auth.uid()
   where s.org_id = private.current_user_org_id();
end;
$$;

-- -----------------------------------------------------------------------------
-- Template admin RPCs (each checks the template's edit_permission, legacy A5)
-- -----------------------------------------------------------------------------
-- A template of the caller's org; both permissions belong to p_module_key, and the caller holds
-- p_edit_permission. Its first version comes from create_template_version.
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

  v_page := case when pg_catalog.jsonb_typeof(v_version.body -> 'blocks') = 'array'
                 then v_version.body -> 'blocks' -> -1 end;
  if v_page ->> 'type' is distinct from 'signaturePage'
     or pg_catalog.jsonb_typeof(v_page -> 'signers') is distinct from 'array' then
    raise exception 'Le modèle doit se terminer par une page de signature.' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_array_length(v_version.signers) = 0 then
    raise exception 'Le modèle doit avoir au moins un signataire.' using errcode = 'P0001';
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
  public.set_signing_settings(text, int),
  public.create_document_template(text, text, text, text, text, text),
  public.create_template_version(uuid),
  public.update_template_version(uuid, jsonb, jsonb, jsonb, text, text),
  public.publish_template_version(uuid),
  public.archive_template_version(uuid),
  public.list_document_templates(text),
  public.list_subject_signature_requests(text, uuid, int, timestamptz, uuid),
  public.get_signature_request(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.set_signing_settings(text, int),
  public.create_document_template(text, text, text, text, text, text),
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
-- key returns the existing row (`existing` = true) and its status, whatever the other fields.
-- p: {org_id, module_key, purpose, template_version_id (null only for core.signing_test),
-- subject_type, subject_id, title, view_permission, idempotency_key, sent_by (null for the
-- system), signers: [{role, name, email, order}]}. Refused (22023): a disabled module, a purpose
-- or view permission outside the module, a version not published (or of another module or org),
-- signers not matching the version (each role one of the version's, every required one present),
-- a sender outside the org. Two signers with one address: P0001 (Documenso reads recipients
-- back by address).
create function public.create_signature_request(p jsonb)
returns table (id uuid, existing boolean, status text)
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
  v_signers jsonb := p -> 'signers';
  v_roles jsonb;
  v_id uuid;
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
     or (select pg_catalog.count(distinct s ->> 'role') from pg_catalog.jsonb_array_elements(v_signers) s)
        <> pg_catalog.jsonb_array_length(v_signers) then
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

  insert into public.signature_requests as r
    (org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, idempotency_key,
     view_permission, sent_by)
  values
    (v_org, v_module, v_purpose, v_version, p ->> 'subject_type', (p ->> 'subject_id')::uuid,
     pg_catalog.btrim(p ->> 'title', E' \t\r\n'), v_key, v_view, v_sent_by)
  on conflict (org_id, idempotency_key) do nothing
  returning r.id into v_id;
  if v_id is null then
    return query
      select r.id, true, r.status from public.signature_requests r
       where r.org_id = v_org and r.idempotency_key = v_key;
    return;
  end if;

  insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order)
  select v_id, v_org, s ->> 'role', pg_catalog.btrim(s ->> 'name'), pg_catalog.btrim(s ->> 'email'),
         (s ->> 'order')::smallint
    from pg_catalog.jsonb_array_elements(v_signers) s;
  return query select v_id, false, 'draft'::text;
end;
$$;

-- Documenso accepted and distributed the document. A live draft (not abandoned) becomes `sent`
-- with its document and envelope ids, expiry and source file; each signer gets its recipient id
-- (p_signer_recipients: [{signer_id, recipient_id}], one per signer). The source file must be
-- this request's `signing_source` system file, ready, with the request's view permission; it
-- stops being staged. Anything else → 22023.
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
  if pg_catalog.jsonb_typeof(p_signer_recipients) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_signer_recipients)
        <> (select pg_catalog.count(*) from public.signature_request_signers s where s.request_id = v_row.id)
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_signer_recipients) e
                 where pg_catalog.jsonb_typeof(e) <> 'object'
                    or (e ->> 'recipient_id') is null
                    or (e ->> 'recipient_id') !~ '^[1-9][0-9]{0,14}$'
                    or not exists (select 1 from public.signature_request_signers s
                                    where s.request_id = v_row.id and s.id::text = e ->> 'signer_id'))
     or (select pg_catalog.count(distinct e ->> 'signer_id') <> pg_catalog.count(*)
                or pg_catalog.count(distinct e ->> 'recipient_id') <> pg_catalog.count(*)
           from pg_catalog.jsonb_array_elements(p_signer_recipients) e) then
    raise exception 'One distinct recipient id per signer of the request' using errcode = '22023';
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
   where s.request_id = v_row.id and s.id::text = e ->> 'signer_id';
  update public.signature_requests r
     set status = 'sent',
         documenso_document_id = p_documenso_document_id,
         envelope_id = p_envelope_id,
         source_file_id = p_source_file_id,
         sent_at = pg_catalog.now(),
         expires_at = p_expires_at,
         last_error = null
   where r.id = v_row.id;
end;
$$;

-- A creation step failed, or the reconcile abandons a stale draft (`abandoned`): the draft keeps
-- the error code and, when given, the Documenso document and envelope it created (to cancel).
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
     set last_error = p_error_code,
         documenso_document_id = coalesce(p_documenso_document_id, r.documenso_document_id),
         envelope_id = coalesce(p_envelope_id, r.envelope_id)
   where r.id = p_id and r.status = 'draft';
  if not found then
    raise exception 'Unknown request, or not a draft' using errcode = '22023';
  end if;
end;
$$;

-- Applies a Documenso event (signing-webhook, signing-sync) under Documenso's raw event names.
-- The row is found by id (the document's externalId), else by document id within p_org_id.
-- Returns `not_found` (no row, a row of another org, or an id and a document id naming two
-- different requests), `ignored` (a disabled module, a draft or a terminal request, an unknown
-- event, or nothing to change) or `applied`. Transitions (monotonic, header):
--   DOCUMENT_OPENED            the recipient pending → viewed; the request sent → viewed
--   DOCUMENT_SIGNED,
--   DOCUMENT_RECIPIENT_COMPLETED  the recipient → signed (and viewed); the request sent → viewed
--   DOCUMENT_COMPLETED         every signer → signed; needs_download (complete_signature_request
--                              then stores the signed PDF and sets `signed`)
--   DOCUMENT_REJECTED          the request → rejected with the reason (control characters
--                              removed, cut to 500); the recipient → rejected
--   DOCUMENT_CANCELLED         the request → cancelled
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
    select * into v_row from public.signature_requests r where r.id = p_request_id for update;
  end if;
  if v_row.id is null and p_documenso_document_id is not null then
    select * into v_row from public.signature_requests r
     where r.org_id = p_org_id and r.documenso_document_id = p_documenso_document_id
       for update;
  end if;
  if v_row.id is null or v_row.org_id <> p_org_id
     or (p_documenso_document_id is not null and v_row.documenso_document_id is distinct from p_documenso_document_id) then
    return query select 'not_found'::text, null::uuid, null::text, false;
    return;
  end if;
  if not public.module_enabled_for_org(v_row.org_id, v_row.module_key)
     or v_row.status not in ('sent', 'viewed') then
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
      return query select 'applied'::text, v_row.id, v_row.module_key, true;
      return;
    when 'DOCUMENT_REJECTED' then
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
    when 'DOCUMENT_CANCELLED' then
      update public.signature_requests r
         set status = 'cancelled', cancelled_at = v_at
       where r.id = v_row.id;
      v_changed := 1;
    else
      null;
  end case;

  return query select case when v_changed > 0 then 'applied' else 'ignored' end, v_row.id, v_row.module_key, false;
end;
$$;

-- The signed PDF is stored: a sent or viewed request becomes `signed` with the file (this
-- request's `signing_signed` system file, ready, with the given hash and the request's view
-- permission; it stops being staged), and every signer is signed. Calling it again with the same
-- file is a no-op; anything else → 22023.
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
     set status = 'signed', completed_at = pg_catalog.now(), signed_file_id = p_signed_file_id,
         signed_sha256 = p_signed_sha256
   where r.id = v_row.id;
end;
$$;

-- core.signing_reconcile (signing-sync, one org at a time): the org's open requests to act on,
-- oldest first, with the action: `expire` (sent or viewed past expires_at: cancel at Documenso,
-- then expire_signature_request), `sync` (sent or viewed for over a day: read Documenso and apply
-- the events, in case a webhook was lost), `abandon` (a draft over a day old and not yet
-- abandoned: cancel its document if any, then mark_signature_request_failed('abandoned')).
-- A disabled module's requests are skipped. Reads signature_requests_open_idx.
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
  select r.id, r.module_key, r.status, r.documenso_document_id, r.envelope_id, r.expires_at,
         case when r.status = 'draft' then 'abandon'
              when r.expires_at < pg_catalog.now() then 'expire'
              else 'sync' end
    from public.signature_requests r
   where r.org_id = p_org_id
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))
     and ((r.status = 'draft' and r.created_at < pg_catalog.now() - interval '1 day')
          or (r.status <> 'draft'
              and (r.sent_at < pg_catalog.now() - interval '1 day' or r.expires_at < pg_catalog.now())))
     and public.module_enabled_for_org(r.org_id, r.module_key)
   order by r.created_at, r.id
   limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

-- A sent or viewed request past its expiry becomes `expired`. True when it did; false for any
-- other request (not overdue, already terminal), which is left as is.
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
   where r.id = p_id and r.status in ('sent', 'viewed') and r.expires_at < pg_catalog.now();
  return found;
end;
$$;

revoke all on function
  public.get_signing_context(uuid, uuid),
  public.create_signature_request(jsonb),
  public.mark_signature_request_sent(uuid, text, text, uuid, jsonb, timestamptz),
  public.mark_signature_request_failed(uuid, text, text, text),
  public.apply_signing_event(uuid, uuid, text, text, text, timestamptz, text),
  public.complete_signature_request(uuid, uuid, text),
  public.list_signature_requests_to_reconcile(uuid, int),
  public.expire_signature_request(uuid)
from public, anon, authenticated;
grant execute on function
  public.get_signing_context(uuid, uuid),
  public.create_signature_request(jsonb),
  public.mark_signature_request_sent(uuid, text, text, uuid, jsonb, timestamptz),
  public.mark_signature_request_failed(uuid, text, text, text),
  public.apply_signing_event(uuid, uuid, text, text, text, timestamptz, text),
  public.complete_signature_request(uuid, uuid, text),
  public.list_signature_requests_to_reconcile(uuid, int),
  public.expire_signature_request(uuid)
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
