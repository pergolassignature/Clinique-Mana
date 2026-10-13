-- =============================================================================
-- Clients: client consents, part 1 (batch C5a)
-- =============================================================================
-- Plan:    docs/plans/2026-10-11-modules-coding-plan.md §6 « C5 — client consents » (C5a), roadmap
--          §2.2 bis, decisions R-46 … R-51 and CC-1 … in the decisions log.
-- Needs:   *_clients_module.sql (clients, client_relations, the module and its permissions),
--          *_core_signing.sql and *_core_signing_second_client_signer.sql (templates, requests,
--          the `client_2` role), *_core_secure_links.sql, *_core_email.sql,
--          *_core_notifications.sql, *_core_scheduled_jobs.sql.
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6; docs/modules/core.md « How a
--          module plugs in » (data, never code).
--
-- Key choices
-- * The consents: `client_consent_types`, the clinic's catalogue (the 7 texts of GOrendezvous,
--   tour §15: general, waitlist, file transfer, intern in psychotherapy, coaching, naturopathy,
--   external EAP), each with its « Oui / Non » clauses (R-46: answered on our page before the
--   signature, printed in the PDF, stored with the request). One core document template per
--   (consent, language): `clients.consent_<key>_fr` / `_en`, seeded as DRAFTS whose first line is
--   « Texte provisoire » (Christine's texts are not in yet): nothing is requestable until a version
--   is published (Mise en service).
-- * Rules (`client_consent_rules`): which consent a situation needs, `once` or `each_time`; the
--   trigger kinds `general`, `service` (target: a 5-digit service code), `payer_kind` (ivac, pae),
--   `professional_status` (intern), `situation` (waitlist, file_transfer, coaching). Seeded for
--   the 7 texts, INACTIVE until their text is published. `private.required_consents_for(…)` is
--   what Rendez-vous (R1) and Demandes (D3) ask; booking is never blocked (R-47).
-- * Requests (`client_consent_requests`): one open per client and consent; the version, the
--   language (the client's) and the clauses are fixed when sent. Signers (R-48): the client from
--   14 (birthday unknown: the client); under 14, the related people who « gèrent les rendez-vous
--   et formulaires » (client_relations `*_manages_appointments`) as parent or guardian, both when
--   `clients.shared_custody` is set (roles `client` and `client_2`); none → P0001 HINT
--   `signer_required`. Each signer has a row (`client_consent_request_signers`) and a secure link
--   of its own (purpose `client_consent`, 14 days, subject the signer row): the token is made and
--   hashed by `clients-consent-send` (actor model, ADR 0007), never seen by staff.
-- * The public page (`/consentement`, function `clients-consent-sign`): an identity check (the
--   client's first name and birth year), the clauses (answered once, by the first signer), then
--   Documenso embedded signing; one signature request for every signer (purpose `clients.consent`,
--   subject the consent request). The links are not consumed by opening: a signer may come back;
--   they are revoked once the request is signed, declined, expired or cancelled.
-- * `client_consents`: the consent in force per client and consent (one active: not superseded,
--   not withdrawn), written by the capture trigger when core stores the signed PDF
--   (`private.clients_mark_consent_signed`), or by the import (`source = 'import'`, I1).
--   `resign_requested_at`: a new version published for « tous les clients actifs » (R-49).
--   Withdrawal columns are here; the RPC and its UI are C5b (R-51).
-- * Providers read the states of their own clients only, through `my_client_consents`
--   (security invoker over a definer function checking clients.self, as `my_clients`, CL-5).
-- * Audited: types, rules, settings, requests (answers redacted), signers, consents (signer
--   names, answers and notes redacted).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consents', true);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- A client's age in whole years on the clinic's date, or null without a birthday.
create function private.clients_age_on(p_birthday date, p_on date)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_birthday is null or p_on is null then null
              else pg_catalog.date_part('year', pg_catalog.age(p_on, p_birthday))::int end
$$;

-- The clinic's date for an organization (service context: no current user).
create function private.clients_org_today(p_org uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.now() at time zone o.timezone)::date from public.organizations o where o.id = p_org
$$;

-- Lower case, accents and spaces folded: the identity check's comparison form.
create function private.clients_fold(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  -- Latin names: letters and digits only (« Marie-Ève » = « marie eve »); a name with no Latin
  -- letter keeps its own, spaces removed (it would otherwise fold to nothing).
  with f as (
    select pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, pg_catalog.btrim(coalesce(p_text, '')))) as v
  )
  select coalesce(nullif(pg_catalog.regexp_replace(f.v, '[^a-z0-9]+', '', 'g'), ''),
                  pg_catalog.regexp_replace(f.v, '[[:space:][:punct:]]+', '', 'g'))
    from f
$$;

revoke all on function
  private.clients_age_on(date, date),
  private.clients_org_today(uuid),
  private.clients_fold(text)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- client_consent_types: the clinic's consents and their « Oui / Non » clauses
-- -----------------------------------------------------------------------------
-- clauses: [{key, kind, text_fr, text_en}], kind `agree` (« Accord requis »: must be « Oui ») or
-- `yes_no` (either answer is kept).
create function private.client_consent_clauses_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p) = 'array'
     and pg_catalog.jsonb_array_length(p) <= 20
     and not exists (
           select 1 from pg_catalog.jsonb_array_elements(p) c
            where pg_catalog.jsonb_typeof(c) <> 'object'
               or coalesce(c ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
               or coalesce(c ->> 'kind', '') not in ('agree', 'yes_no')
               or pg_catalog.length(pg_catalog.btrim(coalesce(c ->> 'text_fr', ''))) not between 1 and 1000
               or pg_catalog.length(pg_catalog.btrim(coalesce(c ->> 'text_en', ''))) not between 1 and 1000)
     and (select pg_catalog.count(distinct c ->> 'key') = pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p) c)
$$;
revoke all on function private.client_consent_clauses_valid(jsonb) from public, anon, authenticated, service_role;

create table public.client_consent_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name_fr text not null,
  name_en text not null,
  clauses jsonb not null default '[]',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_consent_types_key_check check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint client_consent_types_name_fr_check check (char_length(name_fr) between 1 and 120 and private.is_tidy_text(name_fr)),
  constraint client_consent_types_name_en_check check (char_length(name_en) between 1 and 120 and private.is_tidy_text(name_en)),
  constraint client_consent_types_clauses_check check (private.client_consent_clauses_valid(clauses)),
  constraint client_consent_types_org_id_key_key unique (org_id, key)
);

create trigger client_consent_types_set_updated_at
  before update on public.client_consent_types
  for each row execute function private.set_updated_at();
create trigger client_consent_types_audit
  after insert or update or delete on public.client_consent_types
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- client_consent_rules: which consent a situation needs
-- -----------------------------------------------------------------------------
create table public.client_consent_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  consent_key text not null,
  trigger_kind text not null,
  target text,
  frequency text not null default 'once',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint client_consent_rules_type_fkey foreign key (org_id, consent_key)
    references public.client_consent_types (org_id, key) on delete cascade,
  constraint client_consent_rules_trigger_kind_check
    check (trigger_kind in ('general', 'service', 'payer_kind', 'professional_status', 'situation')),
  constraint client_consent_rules_target_check check (
    case trigger_kind
      when 'general' then target is null
      when 'service' then target ~ '^[0-9]{5}$'
      when 'payer_kind' then target in ('ivac', 'pae')
      when 'professional_status' then target in ('intern')
      else target ~ '^[a-z][a-z0-9_]{1,40}$'
    end),
  constraint client_consent_rules_frequency_check check (frequency in ('once', 'each_time'))
);
create unique index client_consent_rules_unique_idx
  on public.client_consent_rules (org_id, consent_key, trigger_kind, coalesce(target, ''));
create index client_consent_rules_created_by_idx on public.client_consent_rules (created_by);

create trigger client_consent_rules_set_updated_at
  before update on public.client_consent_rules
  for each row execute function private.set_updated_at();
create trigger client_consent_rules_audit
  after insert or update or delete on public.client_consent_rules
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- client_consent_settings: one row per clinic
-- -----------------------------------------------------------------------------
create table public.client_consent_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- A request made for a first appointment is due this many days before it.
  due_days_before_first_appointment int not null default 1,
  -- A pending request is sent again (new links) after this many days, once.
  reminder_days int not null default 7,
  -- The notice and email before an appointment with a missing required consent (Rendez-vous).
  pre_appointment_reminder_hours int not null default 48,
  -- How long signed consents are kept: Christine's policy, as text, until it is set (R-50).
  retention_policy text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint client_consent_settings_due_check check (due_days_before_first_appointment between 0 and 30),
  constraint client_consent_settings_reminder_check check (reminder_days between 1 and 30),
  constraint client_consent_settings_pre_check check (pre_appointment_reminder_hours between 12 and 168),
  constraint client_consent_settings_retention_check
    check (char_length(retention_policy) between 1 and 500 and private.is_tidy_text(retention_policy))
);
create index client_consent_settings_updated_by_idx on public.client_consent_settings (updated_by);

create trigger client_consent_settings_set_updated_at
  before update on public.client_consent_settings
  for each row execute function private.set_updated_at();
create trigger client_consent_settings_audit
  after insert or update or delete on public.client_consent_settings
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- client_consent_requests and their signers
-- -----------------------------------------------------------------------------
create table public.client_consent_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null,
  consent_key text not null,
  language text not null,
  template_version_id uuid not null,
  -- The clauses as sent (the type's, at that moment).
  clauses jsonb not null default '[]',
  -- What the request is for: an appointment, a demande, a waitlist entry, the record itself.
  context_type text,
  context_id uuid,
  due_at timestamptz,
  state text not null default 'pending',
  -- clause key → 'yes' | 'no', given on the public page by the first signer.
  answers jsonb,
  answered_at timestamptz,
  signed_at timestamptz,
  last_sent_at timestamptz not null default now(),
  reminded_at timestamptz,
  requested_by uuid references public.profiles(user_id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_consent_requests_org_id_id_key unique (org_id, id),
  constraint client_consent_requests_client_fkey foreign key (org_id, client_id)
    references public.clients (org_id, id) on delete cascade,
  constraint client_consent_requests_type_fkey foreign key (org_id, consent_key)
    references public.client_consent_types (org_id, key),
  constraint client_consent_requests_version_fkey foreign key (template_version_id, org_id)
    references public.document_template_versions (id, org_id),
  constraint client_consent_requests_language_check check (language in ('fr', 'en')),
  constraint client_consent_requests_clauses_check check (private.client_consent_clauses_valid(clauses)),
  constraint client_consent_requests_context_check check (
    (context_type is null and context_id is null)
    or (context_type in ('appointment', 'demande', 'waitlist_entry', 'record') and context_id is not null)),
  constraint client_consent_requests_state_check
    check (state in ('pending', 'signed', 'declined', 'expired', 'cancelled')),
  constraint client_consent_requests_answers_check
    check (answers is null or (pg_catalog.jsonb_typeof(answers) = 'object' and pg_catalog.pg_column_size(answers) <= 8192)),
  constraint client_consent_requests_answered_check check ((answers is null) = (answered_at is null)),
  constraint client_consent_requests_signed_check check ((state = 'signed') = (signed_at is not null)),
  constraint client_consent_requests_cancelled_check check ((state = 'cancelled') = (cancelled_at is not null))
);
-- One open request per client and consent.
create unique index client_consent_requests_open_idx
  on public.client_consent_requests (org_id, client_id, consent_key) where state = 'pending';
create index client_consent_requests_client_idx on public.client_consent_requests (org_id, client_id, created_at desc);
create index client_consent_requests_type_idx on public.client_consent_requests (org_id, consent_key);
create index client_consent_requests_version_idx on public.client_consent_requests (template_version_id, org_id);
create index client_consent_requests_pending_idx on public.client_consent_requests (org_id, last_sent_at) where state = 'pending';
create index client_consent_requests_requested_by_idx on public.client_consent_requests (requested_by);
create index client_consent_requests_cancelled_by_idx on public.client_consent_requests (cancelled_by);

create trigger client_consent_requests_set_updated_at
  before update on public.client_consent_requests
  for each row execute function private.set_updated_at();
-- The answers are the person's own: never in the append-only log.
create trigger client_consent_requests_audit
  after insert or update or delete on public.client_consent_requests
  for each row execute function private.audit_trigger('answers');

create table public.client_consent_request_signers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  request_id uuid not null,
  -- `client`: the client, or the first parent or guardian; `client_2`: the second (shared custody).
  role text not null,
  -- Who signs: the client herself or the related person (both are clients, CL rules).
  signer_client_id uuid not null,
  relation_id uuid,
  link_id uuid,
  last_sent_at timestamptz,
  opened_at timestamptz,
  -- Identity checks that failed on this signer's links: at IDENTITY_MAX the link is revoked (staff re-send).
  identity_failures int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_consent_request_signers_request_fkey foreign key (org_id, request_id)
    references public.client_consent_requests (org_id, id) on delete cascade,
  constraint client_consent_request_signers_signer_fkey foreign key (org_id, signer_client_id)
    references public.clients (org_id, id) on delete cascade,
  constraint client_consent_request_signers_relation_fkey foreign key (relation_id)
    references public.client_relations (id) on delete set null,
  constraint client_consent_request_signers_link_fkey foreign key (link_id)
    references public.secure_links (id) on delete set null,
  constraint client_consent_request_signers_role_check check (role in ('client', 'client_2')),
  constraint client_consent_request_signers_failures_check check (identity_failures >= 0),
  constraint client_consent_request_signers_role_key unique (request_id, role)
);
create index client_consent_request_signers_org_request_idx on public.client_consent_request_signers (org_id, request_id);
create index client_consent_request_signers_signer_idx on public.client_consent_request_signers (org_id, signer_client_id);
create index client_consent_request_signers_relation_idx on public.client_consent_request_signers (relation_id);
create index client_consent_request_signers_link_idx on public.client_consent_request_signers (link_id);

create trigger client_consent_request_signers_set_updated_at
  before update on public.client_consent_request_signers
  for each row execute function private.set_updated_at();
create trigger client_consent_request_signers_audit
  after insert or update or delete on public.client_consent_request_signers
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- client_consents: the consent in force
-- -----------------------------------------------------------------------------
create table public.client_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_id uuid not null,
  consent_key text not null,
  language text not null,
  template_version_id uuid,
  -- « v3 » for ours; GOrendezvous's own label for an imported fact.
  version_label text not null,
  signed_at timestamptz not null,
  -- [{name, role, relation}] as printed: personal, redacted.
  signed_by jsonb not null default '[]',
  answers jsonb,
  signed_file_id uuid references public.stored_files(id) on delete set null,
  request_id uuid,
  source text not null default 'app',
  resign_requested_at timestamptz,
  superseded_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles(user_id) on delete set null,
  withdrawal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_consents_client_fkey foreign key (org_id, client_id)
    references public.clients (org_id, id) on delete cascade,
  constraint client_consents_type_fkey foreign key (org_id, consent_key)
    references public.client_consent_types (org_id, key),
  constraint client_consents_version_fkey foreign key (template_version_id, org_id)
    references public.document_template_versions (id, org_id),
  constraint client_consents_request_fkey foreign key (org_id, request_id)
    references public.client_consent_requests (org_id, id) on delete set null (request_id),
  constraint client_consents_language_check check (language in ('fr', 'en')),
  constraint client_consents_version_label_check check (char_length(version_label) between 1 and 40 and private.is_tidy_text(version_label)),
  constraint client_consents_signed_by_check check (pg_catalog.jsonb_typeof(signed_by) = 'array' and pg_catalog.pg_column_size(signed_by) <= 4096),
  constraint client_consents_answers_check check (answers is null or pg_catalog.jsonb_typeof(answers) = 'object'),
  constraint client_consents_source_check check (source in ('app', 'import')),
  constraint client_consents_app_check check (source = 'import' or template_version_id is not null),
  constraint client_consents_withdrawal_check check (withdrawn_at is not null or (withdrawn_by is null and withdrawal_note is null)),
  constraint client_consents_note_check check (char_length(withdrawal_note) between 1 and 500)
);
-- The consent in force: one per client and consent.
create unique index client_consents_active_idx
  on public.client_consents (org_id, client_id, consent_key) where superseded_at is null and withdrawn_at is null;
create index client_consents_client_idx on public.client_consents (org_id, client_id);
create index client_consents_type_idx on public.client_consents (org_id, consent_key);
create index client_consents_version_idx on public.client_consents (template_version_id, org_id);
create index client_consents_request_idx on public.client_consents (org_id, request_id);
create index client_consents_signed_file_idx on public.client_consents (signed_file_id);
create index client_consents_withdrawn_by_idx on public.client_consents (withdrawn_by);

create trigger client_consents_set_updated_at
  before update on public.client_consents
  for each row execute function private.set_updated_at();
create trigger client_consents_audit
  after insert or update or delete on public.client_consents
  for each row execute function private.audit_trigger('signed_by', 'answers', 'withdrawal_note');

-- -----------------------------------------------------------------------------
-- Privileges and RLS: read with clients.view; every write is an RPC
-- -----------------------------------------------------------------------------
alter table public.client_consent_types enable row level security;
alter table public.client_consent_rules enable row level security;
alter table public.client_consent_settings enable row level security;
alter table public.client_consent_requests enable row level security;
alter table public.client_consent_request_signers enable row level security;
alter table public.client_consents enable row level security;

revoke all on public.client_consent_types, public.client_consent_rules, public.client_consent_settings,
              public.client_consent_requests, public.client_consent_request_signers, public.client_consents
  from anon, authenticated;
grant select on public.client_consent_types, public.client_consent_rules, public.client_consent_settings,
                public.client_consent_requests, public.client_consent_request_signers, public.client_consents
  to authenticated;

create policy client_consent_types_select on public.client_consent_types
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_consent_rules_select on public.client_consent_rules
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_consent_settings_select on public.client_consent_settings
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_consent_requests_select on public.client_consent_requests
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_consent_request_signers_select on public.client_consent_request_signers
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_consents_select on public.client_consents
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));

-- -----------------------------------------------------------------------------
-- Seeds: the 7 consents, their rules (inactive), the settings, the 14 draft templates
-- -----------------------------------------------------------------------------
-- The 7 consents of GOrendezvous (tour §15) with one placeholder clause each, marked provisional.
create function private.clients_consent_types_seed()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select $json$[
    {"key": "general", "name_fr": "Consentement général", "name_en": "General consent", "sort": 10,
     "rule": {"trigger_kind": "general", "target": null}},
    {"key": "waitlist", "name_fr": "Liste d'attente en psychologie et psychothérapie", "name_en": "Psychology and psychotherapy waitlist", "sort": 20,
     "rule": {"trigger_kind": "situation", "target": "waitlist"}},
    {"key": "file_transfer", "name_fr": "Transfert de dossier clinique", "name_en": "Clinical file transfer", "sort": 30,
     "rule": {"trigger_kind": "situation", "target": "file_transfer"}},
    {"key": "intern", "name_fr": "Stagiaire en psychothérapie", "name_en": "Psychotherapy intern", "sort": 40,
     "rule": {"trigger_kind": "professional_status", "target": "intern"}},
    {"key": "coaching", "name_fr": "Coaching", "name_en": "Coaching", "sort": 50,
     "rule": {"trigger_kind": "situation", "target": "coaching"}},
    {"key": "naturopathy", "name_fr": "Naturopathie", "name_en": "Naturopathy", "sort": 60,
     "rule": {"trigger_kind": "service", "target": "10157"}},
    {"key": "eap", "name_fr": "PAE externe", "name_en": "External EAP", "sort": 70,
     "rule": {"trigger_kind": "payer_kind", "target": "pae"}}
  ]$json$::jsonb
$$;

-- One template version body per consent and language: a provisional text, the clauses' block,
-- the signature page (the client or a parent; a second parent under shared custody).
create function private.clients_consent_template(p_name text, p_lang text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_lang = 'en' then pg_catalog.jsonb_build_object(
    'body', pg_catalog.jsonb_build_object(
      'title', p_name,
      'footer', pg_catalog.jsonb_build_object('text', '{{clinic.name}} — ' || p_name),
      'blocks', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Texte provisoire — Provisional text, to be approved by the clinic''s management before publication.', 'bold', true))),
        pg_catalog.jsonb_build_object('type', 'heading', 'level', 1, 'text', p_name),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Client: '),
          pg_catalog.jsonb_build_object('text', '{{client.full_name}}', 'bold', true))),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'This provisional text stands in for the consent of {{clinic.name}}. It will be replaced by the approved text.'))),
        pg_catalog.jsonb_build_object('type', 'heading', 'level', 2, 'text', 'Your answers'),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', '{{consent.clauses}}'))),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Signed on {{today}} for {{client.full_name}}.'))),
        pg_catalog.jsonb_build_object('type', 'signaturePage', 'signers', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('role', 'client', 'label', '{{signer.full_name}}'),
          pg_catalog.jsonb_build_object('role', 'client_2', 'label', '{{signer_2.full_name}}'))))),
    'email_subject', p_name || ' — {{clinic.name}}',
    'email_message', '')
  else pg_catalog.jsonb_build_object(
    'body', pg_catalog.jsonb_build_object(
      'title', p_name,
      'footer', pg_catalog.jsonb_build_object('text', '{{clinic.name}} — ' || p_name),
      'blocks', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Texte provisoire — à faire valider par la direction avant publication.', 'bold', true))),
        pg_catalog.jsonb_build_object('type', 'heading', 'level', 1, 'text', p_name),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Client : '),
          pg_catalog.jsonb_build_object('text', '{{client.full_name}}', 'bold', true))),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Ce texte provisoire tient la place du consentement de {{clinic.name}}. Il sera remplacé par le texte validé par la direction.'))),
        pg_catalog.jsonb_build_object('type', 'heading', 'level', 2, 'text', 'Vos réponses'),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', '{{consent.clauses}}'))),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Signé le {{today}} pour {{client.full_name}}.'))),
        pg_catalog.jsonb_build_object('type', 'signaturePage', 'signers', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('role', 'client', 'label', '{{signer.full_name}}'),
          pg_catalog.jsonb_build_object('role', 'client_2', 'label', '{{signer_2.full_name}}'))))),
    'email_subject', p_name || ' — {{clinic.name}}',
    'email_message', '')
  end
  || pg_catalog.jsonb_build_object(
    'variables', $vars$[
      {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
      {"path": "client.full_name", "label": "Nom du client", "sample": "Camille Exemple", "required": true, "kind": "text"},
      {"path": "client.first_name", "label": "Prénom du client", "sample": "Camille", "required": true, "kind": "text"},
      {"path": "signer.full_name", "label": "Nom de la personne qui signe", "sample": "Camille Exemple", "required": true, "kind": "text"},
      {"path": "signer_2.full_name", "label": "Nom du deuxième parent (garde partagée)", "sample": "Alex Exemple", "required": false, "kind": "text"},
      {"path": "consent.clauses", "label": "Réponses aux clauses (Oui / Non)", "sample": "Oui", "required": false, "kind": "text"},
      {"path": "today", "label": "Date du jour", "sample": "2026-10-12", "required": true, "kind": "date"}
    ]$vars$::jsonb,
    'signers', $signers$[
      {"role": "client", "label": "Client, ou parent ou tuteur", "order": 1, "required": true},
      {"role": "client_2", "label": "Deuxième parent (garde partagée)", "order": 2, "required": false}
    ]$signers$::jsonb)
$$;

create function private.seed_clients_consents(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_type jsonb;
  v_lang text;
  v_name text;
  v_template uuid;
  v_content jsonb;
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:clients_consents', true);
  insert into public.client_consent_settings (org_id) values (p_org) on conflict do nothing;
  for v_type in select t from pg_catalog.jsonb_array_elements(private.clients_consent_types_seed()) t loop
    insert into public.client_consent_types (org_id, key, name_fr, name_en, clauses, sort_order)
    values (p_org, v_type ->> 'key', v_type ->> 'name_fr', v_type ->> 'name_en',
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'key', 'accord', 'kind', 'agree',
              'text_fr', 'Clause provisoire : j''ai lu ce consentement et je l''accepte.',
              'text_en', 'Provisional clause: I have read this consent and I agree to it.')),
            (v_type ->> 'sort')::int)
    on conflict (org_id, key) do nothing;
    insert into public.client_consent_rules (org_id, consent_key, trigger_kind, target, frequency, is_active)
    values (p_org, v_type ->> 'key', v_type -> 'rule' ->> 'trigger_kind', v_type -> 'rule' ->> 'target', 'once', false)
    on conflict do nothing;
    foreach v_lang in array array['fr', 'en'] loop
      v_name := case when v_lang = 'en' then v_type ->> 'name_en' else v_type ->> 'name_fr' end;
      v_content := private.clients_consent_template(v_name, v_lang);
      insert into public.document_templates as t
        (org_id, key, module_key, title, description, view_permission, edit_permission)
      values
        (p_org, 'clients.consent_' || (v_type ->> 'key') || '_' || v_lang, 'clients',
         v_name || case when v_lang = 'en' then ' (anglais)' else ' (français)' end,
         'Consentement du client, signé électroniquement avant ou pendant le suivi.',
         'clients.view', 'clients.manage')
      on conflict (org_id, key) do nothing
      returning t.id into v_template;
      if v_template is not null then
        insert into public.document_template_versions
          (template_id, org_id, version, body, variables, signers, email_subject, email_message)
        values
          (v_template, p_org, 1, v_content -> 'body', v_content -> 'variables', v_content -> 'signers',
           v_content ->> 'email_subject', v_content ->> 'email_message');
      end if;
    end loop;
  end loop;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_clients_consents_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_clients_consents(new.id);
  return null;
end;
$$;

create trigger organizations_seed_clients_consents
  after insert on public.organizations
  for each row execute function private.seed_clients_consents_on_org();

revoke all on function
  private.clients_consent_types_seed(),
  private.clients_consent_template(text, text),
  private.seed_clients_consents(uuid),
  private.seed_clients_consents_on_org()
from public, anon, authenticated, service_role;

select private.seed_clients_consents(o.id) from public.organizations o;

-- -----------------------------------------------------------------------------
-- Secure link purpose, email templates, notification kinds
-- -----------------------------------------------------------------------------
-- What resolve-link shows before the identity check: the clinic and the consent's name only.
create function public.resolve_client_consent_link(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'clinic_name', o.name,
           'language', r.language,
           'consent_name', case when r.language = 'en' then t.name_en else t.name_fr end,
           'expires_at', l.expires_at)
    from public.secure_links l
    join public.client_consent_request_signers s on s.id = l.subject_id and s.org_id = l.org_id
    join public.client_consent_requests r on r.id = s.request_id and r.org_id = s.org_id
    join public.client_consent_types t on t.org_id = r.org_id and t.key = r.consent_key
    join public.organizations o on o.id = l.org_id
   where l.id = p_link_id and l.purpose = 'client_consent' and l.subject_type = 'client_consent_signer'
     and l.revoked_at is null and l.expires_at > pg_catalog.now() and l.use_count < l.max_uses
     and r.state = 'pending'
$$;
revoke all on function public.resolve_client_consent_link(uuid) from public, anon, authenticated;
grant execute on function public.resolve_client_consent_link(uuid) to service_role;

insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission)
values ('client_consent', 'clients', interval '14 days', interval '30 days', 1, false, false,
        'resolve_client_consent_link', null, 'clients.view')
on conflict do nothing;

insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
values
  ('clients.consent_request', 'clients',
   'Demande de consentement',
   'Envoyé à la personne qui doit signer un consentement du client (le client, ou son parent ou tuteur).',
   'Vous recevez ce courriel parce que la clinique vous demande de signer un consentement.',
   '{{consent.name}} — {{clinic.name}}',
   E'Bonjour {{signer.first_name}},\n\n'
   '{{clinic.name}} vous demande de lire et de signer le formulaire « {{consent.name}} » pour {{client.first_name}}. '
   'Cela prend quelques minutes : vous répondrez à quelques questions, puis vous signerez en ligne.\n\n'
   'Ce lien est personnel et reste valide jusqu''au {{link.expires_at}}.\n\n'
   'Pour toute question, communiquez avec la clinique.',
   'Lire et signer',
   '[
     {"path": "signer.first_name", "label": "Prénom de la personne qui signe", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "client.first_name", "label": "Prénom du client", "sample": "Léa", "required": true, "kind": "text"},
     {"path": "consent.name", "label": "Nom du consentement", "sample": "Consentement général", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "link.expires_at", "label": "Fin de validité du lien", "sample": "26 octobre 2026 à 14 h 30", "required": true, "kind": "datetime"}
   ]',
   'clients.view'),
  ('clients.consent_request_en', 'clients',
   'Demande de consentement (anglais)',
   'La demande de consentement envoyée en anglais, quand la langue du client est l''anglais.',
   'You receive this email because the clinic asks you to sign a consent form.',
   '{{consent.name}} — {{clinic.name}}',
   E'Hello {{signer.first_name}},\n\n'
   '{{clinic.name}} asks you to read and sign the form "{{consent.name}}" for {{client.first_name}}. '
   'It takes a few minutes: you will answer a few questions, then sign online.\n\n'
   'This link is personal and valid until {{link.expires_at}}.\n\n'
   'If you have any question, please contact the clinic.',
   'Read and sign',
   '[
     {"path": "signer.first_name", "label": "Prénom de la personne qui signe", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "client.first_name", "label": "Prénom du client", "sample": "Léa", "required": true, "kind": "text"},
     {"path": "consent.name", "label": "Nom du consentement", "sample": "General consent", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "link.expires_at", "label": "Fin de validité du lien", "sample": "October 26, 2026 at 2:30 PM", "required": true, "kind": "datetime"}
   ]',
   'clients.view')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Staff RPCs (clients.manage)
-- -----------------------------------------------------------------------------
-- Creates or changes a rule. Returns its id. An unknown consent is a French refusal (HINT
-- `consent_key`); a target that does not fit the trigger kind too (HINT `target`).
create function public.set_client_consent_rule(
  p_id uuid,
  p_consent_key text,
  p_trigger_kind text,
  p_target text,
  p_frequency text,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_id uuid;
  v_target text := nullif(pg_catalog.btrim(coalesce(p_target, '')), '');
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  if not exists (select 1 from public.client_consent_types t where t.org_id = v_org and t.key = p_consent_key) then
    raise exception 'Ce consentement n''existe pas.' using errcode = 'P0001', hint = 'consent_key';
  end if;
  if p_trigger_kind is null or p_trigger_kind not in ('general', 'service', 'payer_kind', 'professional_status', 'situation') then
    raise exception 'Invalid trigger kind' using errcode = '22023';
  end if;
  if p_frequency is null or p_frequency not in ('once', 'each_time') then
    raise exception 'Invalid frequency' using errcode = '22023';
  end if;
  if not (case p_trigger_kind
            when 'general' then v_target is null
            when 'service' then coalesce(v_target ~ '^[0-9]{5}$', false)
            when 'payer_kind' then coalesce(v_target in ('ivac', 'pae'), false)
            when 'professional_status' then coalesce(v_target in ('intern'), false)
            else coalesce(v_target ~ '^[a-z][a-z0-9_]{1,40}$', false) end) then
    raise exception 'La cible ne convient pas à ce déclencheur : un code de service à 5 chiffres, un type de payeur (IVAC, PAE), un statut ou une situation.'
      using errcode = 'P0001', hint = 'target';
  end if;
  if coalesce(p_is_active, false)
     and not exists (select 1 from public.document_templates t
                       join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
                      where t.org_id = v_org and t.key in ('clients.consent_' || p_consent_key || '_fr', 'clients.consent_' || p_consent_key || '_en')) then
    raise exception 'Publiez d''abord le texte de ce consentement : une règle ne s''active qu''une fois son texte publié.'
      using errcode = 'P0001', hint = 'template';
  end if;
  begin
    if p_id is null then
      insert into public.client_consent_rules (org_id, consent_key, trigger_kind, target, frequency, is_active, created_by)
      values (v_org, p_consent_key, p_trigger_kind, v_target, p_frequency, coalesce(p_is_active, false), auth.uid())
      returning id into v_id;
    else
      update public.client_consent_rules r
         set consent_key = p_consent_key, trigger_kind = p_trigger_kind, target = v_target,
             frequency = p_frequency, is_active = coalesce(p_is_active, r.is_active)
       where r.id = p_id and r.org_id = v_org
      returning r.id into v_id;
      if v_id is null then
        raise exception 'Cette règle n''existe plus.' using errcode = 'P0001', hint = 'rule';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Une règle identique existe déjà pour ce consentement.' using errcode = 'P0001', hint = 'duplicate';
  end;
  return v_id;
end;
$$;

-- Merges a patch of known keys into the clinic's settings; returns them.
create function public.set_client_consent_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.client_consent_settings%rowtype;
  v_key text;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Invalid settings' using errcode = '22023';
  end if;
  for v_key in select k from pg_catalog.jsonb_object_keys(p_patch) k loop
    if v_key not in ('due_days_before_first_appointment', 'reminder_days', 'pre_appointment_reminder_hours', 'retention_policy') then
      raise exception 'Réglage inconnu : %', v_key using errcode = '22023';
    end if;
  end loop;
  insert into public.client_consent_settings (org_id) values (v_org) on conflict do nothing;
  begin
    update public.client_consent_settings s
       set due_days_before_first_appointment = case when p_patch ? 'due_days_before_first_appointment'
                                                    then (p_patch ->> 'due_days_before_first_appointment')::int
                                                    else s.due_days_before_first_appointment end,
           reminder_days = case when p_patch ? 'reminder_days' then (p_patch ->> 'reminder_days')::int else s.reminder_days end,
           pre_appointment_reminder_hours = case when p_patch ? 'pre_appointment_reminder_hours'
                                                 then (p_patch ->> 'pre_appointment_reminder_hours')::int
                                                 else s.pre_appointment_reminder_hours end,
           retention_policy = case when p_patch ? 'retention_policy'
                                   then nullif(pg_catalog.btrim(coalesce(p_patch ->> 'retention_policy', '')), '')
                                   else s.retention_policy end,
           updated_by = auth.uid()
     where s.org_id = v_org
    returning * into v_row;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Un réglage est hors des limites : rappel de 1 à 30 jours, délai de 0 à 30 jours, préavis de 12 à 168 heures.'
      using errcode = 'P0001', hint = 'settings';
  end;
  return pg_catalog.to_jsonb(v_row) - 'org_id';
end;
$$;

-- Cancels an open request (staff): its links are revoked. Refused once someone has started
-- signing (a Documenso envelope is out): the request then ends with the signature.
create function public.cancel_client_consent_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_req public.client_consent_requests%rowtype;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  select * into v_req from public.client_consent_requests r where r.id = p_id and r.org_id = v_org for update;
  if v_req.id is null or v_req.state <> 'pending' then
    raise exception 'Cette demande de consentement n''est plus en attente.' using errcode = 'P0001', hint = 'state';
  end if;
  if exists (select 1 from public.signature_requests s
              where s.org_id = v_org and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                and s.subject_id = v_req.id and s.status in ('sent', 'viewed')) then
    raise exception 'La signature est commencée : la demande ne peut plus être annulée.' using errcode = 'P0001', hint = 'signing';
  end if;
  update public.client_consent_requests r
     set state = 'cancelled', cancelled_at = pg_catalog.now(), cancelled_by = auth.uid()
   where r.id = v_req.id;
  perform private.clients_consent_close_links(v_org, v_req.id, auth.uid());
end;
$$;

-- Revokes every live link of a request's signers.
create function private.clients_consent_close_links(p_org uuid, p_request_id uuid, p_by uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_signer uuid;
begin
  for v_signer in select s.id from public.client_consent_request_signers s where s.org_id = p_org and s.request_id = p_request_id loop
    perform private.revoke_secure_links(p_org, 'client_consent', 'client_consent_signer', v_signer, p_by);
  end loop;
end;
$$;
revoke all on function private.clients_consent_close_links(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Publishes a consent template's draft through core (`publish_template_version`, which checks the
-- template's edit permission, clients.manage) and asks who must sign again (R-49):
-- `new_clients` (the default) changes nothing for the signed consents; `all_active` flags every
-- consent in force of that consent and language signed on another version « À signer de nouveau ».
-- Returns the number of consents flagged.
create function public.publish_client_consent_version(p_version_id uuid, p_population text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_key text;
  v_consent text;
  v_lang text;
  v_count int := 0;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  if p_population is null or p_population not in ('new_clients', 'all_active') then
    raise exception 'Invalid population' using errcode = '22023';
  end if;
  select t.key into v_key
    from public.document_template_versions v
    join public.document_templates t on t.id = v.template_id
   where v.id = p_version_id and v.org_id = v_org and t.module_key = 'clients';
  if v_key is null or v_key !~ '^clients\.consent_[a-z0-9_]+_(fr|en)$' then
    raise exception 'Ce texte n''est pas un consentement de client.' using errcode = 'P0001', hint = 'template';
  end if;
  v_lang := pg_catalog.right(v_key, 2);
  v_consent := pg_catalog.regexp_replace(v_key, '^clients\.consent_(.+)_(fr|en)$', '\1');
  perform public.publish_template_version(p_version_id);
  -- The requests out on the previous version and not yet in signing now print this one (the
  -- previous version is archived: no signature request could be made from it).
  update public.client_consent_requests r
     set template_version_id = p_version_id
   where r.org_id = v_org and r.consent_key = v_consent and r.language = v_lang and r.state = 'pending'
     and r.template_version_id <> p_version_id
     and not exists (select 1 from public.signature_requests s
                      where s.org_id = r.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                        and s.subject_id = r.id and s.status in ('draft', 'sent', 'viewed'));
  if p_population = 'all_active' then
    update public.client_consents c
       set resign_requested_at = pg_catalog.now()
     where c.org_id = v_org and c.consent_key = v_consent and c.language = v_lang
       and c.superseded_at is null and c.withdrawn_at is null
       and c.template_version_id is distinct from p_version_id;
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Who signs (R-48)
-- -----------------------------------------------------------------------------
-- The signers of a client's consent: [{role, signer_client_id, relation_id}], or a French refusal
-- (P0001, HINT `signer_required`). From 14 (or without a birthday): the client. Under 14: the
-- related people who manage the client's appointments and forms, as parent or guardian, the main
-- contact first; both under shared custody (two needed, else refused); one otherwise.
create function private.clients_consent_signers(p_org uuid, p_client_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_age int;
  v_people jsonb;
  v_needed int;
begin
  select * into v_client from public.clients c where c.org_id = p_org and c.id = p_client_id;
  if v_client.id is null then
    raise exception 'Client introuvable.' using errcode = 'P0001', hint = 'client';
  end if;
  v_age := private.clients_age_on(v_client.birthday, private.clients_org_today(p_org));
  if v_age is null or v_age >= 14 then
    return pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', 'client', 'signer_client_id', v_client.id, 'relation_id', null));
  end if;
  -- The other side of each relation, when it manages this client's appointments as parent or guardian.
  select coalesce(pg_catalog.jsonb_agg(x.person order by x.main desc, x.created_at), '[]') into v_people
    from (select pg_catalog.jsonb_build_object('signer_client_id', case when r.client_a_id = p_client_id then r.client_b_id else r.client_a_id end,
                                               'relation_id', r.id) as person,
                 case when r.client_a_id = p_client_id then r.b_main_contact else r.a_main_contact end as main,
                 r.created_at
            from public.client_relations r
            join public.clients o on o.org_id = r.org_id
                                 and o.id = case when r.client_a_id = p_client_id then r.client_b_id else r.client_a_id end
           where r.org_id = p_org and (r.client_a_id = p_client_id or r.client_b_id = p_client_id)
             and o.archived_at is null and o.anonymized_at is null
             and case when r.client_a_id = p_client_id
                      then r.b_manages_appointments and r.type_b_to_a in ('parent', 'guardian')
                      else r.a_manages_appointments and r.type_a_to_b in ('parent', 'guardian') end) x;
  v_needed := case when v_client.shared_custody then 2 else 1 end;
  if pg_catalog.jsonb_array_length(v_people) < v_needed then
    raise exception '%', case when v_client.shared_custody
      then 'Ce client a moins de 14 ans et sa garde est partagée : ses deux parents doivent signer. Ajoutez-les dans ses proches avec le droit « Gérer les rendez-vous et formulaires ».'
      else 'Ce client a moins de 14 ans : un parent ou un tuteur doit signer. Ajoutez-le dans ses proches avec le droit « Gérer les rendez-vous et formulaires ».' end
      using errcode = 'P0001', hint = 'signer_required';
  end if;
  return (select pg_catalog.jsonb_agg(p.value || pg_catalog.jsonb_build_object('role', case when p.ordinality = 1 then 'client' else 'client_2' end)
                                      order by p.ordinality)
            from pg_catalog.jsonb_array_elements(v_people) with ordinality p
           where p.ordinality <= v_needed);
end;
$$;
revoke all on function private.clients_consent_signers(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Sending (service role, the actor model: clients-consent-send makes and hashes the tokens)
-- -----------------------------------------------------------------------------
-- Prepares a request for p_client_id and p_consent_key, or sends an open one again (new links,
-- the old ones revoked): checks the actor (an active member of p_org holding clients.manage; null
-- only for the reminder job), the client (not archived or anonymised), the published version in
-- the client's language, the signers and their addresses; issues one link per signer with the
-- given hashes (the first for `client`, the second for `client_2`; two always, the second unused
-- for one signer). Returns
-- { request_id, resent, language, consent_name, client_first_name, clinic_name, expires_at,
--   signers: [{ role, signer_id, first_name, full_name, email, link_id }] }.
-- Refusals (P0001, French, HINT): `client`, `template` (no published text), `signer_required`,
-- `signer_email`, `state`.
create function public.prepare_client_consent_request_for_service(
  p_org_id uuid,
  p_actor uuid,
  p_client_id uuid,
  p_consent_key text,
  p_context_type text,
  p_context_id uuid,
  p_due_at timestamptz,
  p_token_hash_1 bytea,
  p_token_hash_2 bytea,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_type public.client_consent_types%rowtype;
  v_req public.client_consent_requests%rowtype;
  v_version uuid;
  v_signers jsonb;
  v_signer jsonb;
  v_signer_id uuid;
  v_link uuid;
  v_person public.clients%rowtype;
  v_out jsonb := '[]';
  v_i int := 0;
  v_resent boolean := false;
  v_expires timestamptz;
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_org_id is null or p_token_hash_1 is null or p_token_hash_2 is null or p_token_hash_1 = p_token_hash_2 then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'clients') then
    raise exception 'Module disabled' using errcode = '22023';
  end if;
  -- P3-40: nothing leaves for a client while the module is reserved for its testers.
  if not public.module_open_to_all_for_org(p_org_id, 'clients') then
    raise exception 'Le module Clients est réservé aux testeurs : aucune demande de consentement ne part aux clients avant son ouverture à tous.'
      using errcode = 'P0001', hint = 'module_reserved';
  end if;
  if p_actor is not null then
    if not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active')
       or not ('clients.manage' = any (private.permission_keys_for(p_actor))) then
      raise exception 'Permission refusée : clients.manage' using errcode = '42501';
    end if;
    perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  elsif p_request_id is null then
    raise exception 'A new request needs an actor' using errcode = '22023';
  end if;

  if p_request_id is not null then
    select * into v_req from public.client_consent_requests r where r.org_id = p_org_id and r.id = p_request_id for update;
    if v_req.id is null or v_req.state <> 'pending' then
      raise exception 'Cette demande de consentement n''est plus en attente.' using errcode = 'P0001', hint = 'state';
    end if;
    p_client_id := v_req.client_id;
    p_consent_key := v_req.consent_key;
  end if;

  select * into v_client from public.clients c where c.org_id = p_org_id and c.id = p_client_id for update;
  if v_client.id is null or v_client.archived_at is not null or v_client.anonymized_at is not null then
    raise exception 'Ce dossier client n''est pas actif.' using errcode = 'P0001', hint = 'client';
  end if;
  select * into v_type from public.client_consent_types t where t.org_id = p_org_id and t.key = p_consent_key and t.is_active;
  if v_type.id is null then
    raise exception 'Ce consentement n''existe pas.' using errcode = 'P0001', hint = 'consent_key';
  end if;

  if v_req.id is null then
    -- An open request for the same consent is sent again rather than doubled.
    select * into v_req from public.client_consent_requests r
     where r.org_id = p_org_id and r.client_id = p_client_id and r.consent_key = p_consent_key and r.state = 'pending'
     for update;
  end if;

  if v_req.id is null then
    select v.id into v_version
      from public.document_templates t
      join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
     where t.org_id = p_org_id and t.key = 'clients.consent_' || p_consent_key || '_' || v_client.language and t.is_active;
    if v_version is null then
      raise exception 'Le texte de ce consentement n''est pas encore publié en %. Publiez-le dans Paramètres → Consentements.',
        case when v_client.language = 'en' then 'anglais' else 'français' end
        using errcode = 'P0001', hint = 'template';
    end if;
    if (p_context_type is not null and p_context_type not in ('appointment', 'demande', 'waitlist_entry', 'record'))
       or ((p_context_type is null) <> (p_context_id is null)) then
      raise exception 'Invalid context' using errcode = '22023';
    end if;
    v_signers := private.clients_consent_signers(p_org_id, p_client_id);
    insert into public.client_consent_requests
      (org_id, client_id, consent_key, language, template_version_id, clauses, context_type, context_id, due_at, requested_by)
    values
      (p_org_id, p_client_id, p_consent_key, v_client.language, v_version, v_type.clauses, p_context_type,
       p_context_id, p_due_at, p_actor)
    returning * into v_req;
    for v_signer in select s from pg_catalog.jsonb_array_elements(v_signers) s loop
      insert into public.client_consent_request_signers (org_id, request_id, role, signer_client_id, relation_id)
      values (p_org_id, v_req.id, v_signer ->> 'role', (v_signer ->> 'signer_client_id')::uuid, (v_signer ->> 'relation_id')::uuid);
    end loop;
  else
    v_resent := true;
    -- Who signs may have changed since (a right removed, a relation deleted, a birthday, the
    -- custody): without an envelope out, the signers are rebuilt and the former ones' links
    -- revoked; with one out, the signature runs to its end with its signers.
    if not exists (select 1 from public.signature_requests s
                    where s.org_id = p_org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                      and s.subject_id = v_req.id and s.status in ('draft', 'sent', 'viewed')) then
      v_signers := private.clients_consent_signers(p_org_id, v_req.client_id);
      if exists (select 1 from public.client_consent_request_signers x
                  where x.request_id = v_req.id
                    and not exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                                     where s ->> 'role' = x.role and (s ->> 'signer_client_id')::uuid = x.signer_client_id))
         or pg_catalog.jsonb_array_length(v_signers)
            <> (select pg_catalog.count(*) from public.client_consent_request_signers x where x.request_id = v_req.id) then
        perform private.clients_consent_close_links(p_org_id, v_req.id, p_actor);
        delete from public.client_consent_request_signers x where x.request_id = v_req.id;
        for v_signer in select s from pg_catalog.jsonb_array_elements(v_signers) s loop
          insert into public.client_consent_request_signers (org_id, request_id, role, signer_client_id, relation_id)
          values (p_org_id, v_req.id, v_signer ->> 'role', (v_signer ->> 'signer_client_id')::uuid, (v_signer ->> 'relation_id')::uuid);
        end loop;
      end if;
    end if;
    update public.client_consent_requests r
       set last_sent_at = pg_catalog.now(),
           reminded_at = case when p_actor is null then pg_catalog.now() else r.reminded_at end,
           due_at = coalesce(p_due_at, r.due_at)
     where r.id = v_req.id;
  end if;

  for v_signer_id in
    select s.id from public.client_consent_request_signers s where s.request_id = v_req.id order by s.role
  loop
    v_i := v_i + 1;
    select c.* into v_person from public.clients c
      join public.client_consent_request_signers s on s.signer_client_id = c.id and s.org_id = c.org_id
     where s.id = v_signer_id;
    if v_person.email is null or v_person.anonymized_at is not null then
      raise exception 'La personne qui doit signer n''a pas d''adresse courriel : ajoutez-la à son dossier.'
        using errcode = 'P0001', hint = 'signer_email';
    end if;
    v_link := private.issue_secure_link(p_org_id, 'client_consent', 'client_consent_signer', v_signer_id,
                                        case when v_i = 1 then p_token_hash_1 else p_token_hash_2 end, p_actor, null, '{}');
    select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
    update public.client_consent_request_signers s set link_id = v_link, last_sent_at = pg_catalog.now()
     where s.id = v_signer_id;
    v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', (select s.role from public.client_consent_request_signers s where s.id = v_signer_id),
      'signer_id', v_signer_id,
      'first_name', v_person.first_name,
      'full_name', v_person.first_name || ' ' || v_person.last_name,
      'email', v_person.email,
      'link_id', v_link));
  end loop;

  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object(
    'request_id', v_req.id,
    'resent', v_resent,
    'language', v_req.language,
    'consent_name', case when v_req.language = 'en' then v_type.name_en else v_type.name_fr end,
    'client_first_name', v_client.first_name,
    'clinic_name', (select o.name from public.organizations o where o.id = p_org_id),
    'expires_at', v_expires,
    'signers', v_out);
end;
$$;

-- -----------------------------------------------------------------------------
-- The public page (service role: clients-consent-sign, after its per-IP limit)
-- -----------------------------------------------------------------------------
-- The live link of a token and its request, locked; null when the link is unknown, revoked,
-- expired, of another purpose, or its request no longer pending.
create function private.clients_consent_link(p_token_hash bytea)
returns table (link_id uuid, org_id uuid, signer_id uuid, role text, request_id uuid)
language sql
stable
set search_path = ''
as $$
  select l.id, l.org_id, s.id, s.role, r.id
    from public.secure_links l
    join public.client_consent_request_signers s on s.id = l.subject_id and s.org_id = l.org_id
    join public.client_consent_requests r on r.id = s.request_id and r.org_id = s.org_id
   where l.token_hash = p_token_hash and l.purpose = 'client_consent' and l.subject_type = 'client_consent_signer'
     and l.revoked_at is null and l.expires_at > pg_catalog.now() and l.use_count < l.max_uses
     and r.state = 'pending'
$$;
revoke all on function private.clients_consent_link(bytea) from public, anon, authenticated, service_role;

-- Whether the identity typed on the page is the client's: the first name (accents, case and
-- spaces ignored) and the birth year (when the file has a birthday).
create function private.clients_consent_identity_ok(p_org uuid, p_request_id uuid, p_first_name text, p_birth_year int)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
           private.clients_fold(c.first_name) = private.clients_fold(p_first_name)
           and private.clients_fold(p_first_name) <> ''
           and (c.birthday is null or pg_catalog.date_part('year', c.birthday)::int = p_birth_year),
           false)
    from public.client_consent_requests r
    join public.clients c on c.id = r.client_id and c.org_id = r.org_id
   where r.org_id = p_org and r.id = p_request_id
$$;
revoke all on function private.clients_consent_identity_ok(uuid, uuid, text, int) from public, anon, authenticated, service_role;

-- One more failed identity check on a signer's link: `identity_mismatch`, or, at the fifth,
-- `invalid` with the link revoked (the clinic sends a new one): the client's birth year cannot be
-- guessed through one link.
create function private.clients_consent_identity_failed(p_org uuid, p_signer_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_failures int;
begin
  update public.client_consent_request_signers s set identity_failures = s.identity_failures + 1
   where s.id = p_signer_id returning s.identity_failures into v_failures;
  if v_failures >= 5 then
    perform private.revoke_secure_links(p_org, 'client_consent', 'client_consent_signer', p_signer_id, null);
    return '{"state": "invalid"}'::jsonb;
  end if;
  return pg_catalog.jsonb_build_object('state', 'identity_mismatch', 'org_id', p_org);
end;
$$;
revoke all on function private.clients_consent_identity_failed(uuid, uuid) from public, anon, authenticated, service_role;

-- What the page shows once the identity matches. One of:
--   {"state": "invalid"}                     unknown, revoked, expired link, or request closed
--   {"state": "identity_mismatch", "org_id"} (counted per signer: the fifth revokes the link)
--   {"state": "ready", "org_id", "request_id", "role", "language", "clinic_name", "consent_name",
--    "client_first_name", "signer_first_name", "clauses", "answers", "can_answer", "signing"}
-- `signing`: the signature request's status when one exists (sent, viewed…), else null.
create function public.open_client_consent_for_service(p_token_hash bytea, p_first_name text, p_birth_year int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link record;
  v_req public.client_consent_requests%rowtype;
  v_signer_first text;
  v_status text;
begin
  select * into v_link from private.clients_consent_link(p_token_hash);
  if v_link.link_id is null then
    return '{"state": "invalid"}'::jsonb;
  end if;
  if not public.module_enabled_for_org(v_link.org_id, 'clients') then
    return '{"state": "invalid"}'::jsonb;
  end if;
  if not private.clients_consent_identity_ok(v_link.org_id, v_link.request_id, p_first_name, p_birth_year) then
    return private.clients_consent_identity_failed(v_link.org_id, v_link.signer_id);
  end if;
  select * into v_req from public.client_consent_requests r where r.id = v_link.request_id;
  update public.client_consent_request_signers s set opened_at = coalesce(s.opened_at, pg_catalog.now()), identity_failures = 0
   where s.id = v_link.signer_id;
  select c.first_name into v_signer_first
    from public.client_consent_request_signers s join public.clients c on c.id = s.signer_client_id
   where s.id = v_link.signer_id;
  select s.status into v_status from public.signature_requests s
   where s.org_id = v_req.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
     and s.subject_id = v_req.id
   order by s.created_at desc limit 1;
  return pg_catalog.jsonb_build_object(
    'state', 'ready',
    'org_id', v_req.org_id,
    'request_id', v_req.id,
    'role', v_link.role,
    'language', v_req.language,
    'clinic_name', (select o.name from public.organizations o where o.id = v_req.org_id),
    'consent_name', (select case when v_req.language = 'en' then t.name_en else t.name_fr end
                       from public.client_consent_types t where t.org_id = v_req.org_id and t.key = v_req.consent_key),
    'client_first_name', (select c.first_name from public.clients c where c.id = v_req.client_id),
    'signer_first_name', v_signer_first,
    'clauses', v_req.clauses,
    'answers', v_req.answers,
    'can_answer', v_req.answers is null,
    'signing', v_status);
end;
$$;

-- Records the answers (first signer only) and returns what the signature needs. One of:
--   {"state": "invalid" | "identity_mismatch"}
--   {"state": "resume", "org_id", "request_id": <signature request>, "envelope_id", "recipient_id"}
--   {"state": "prepared", "org_id", "consent_request_id", "role", "template_version_id", "title",
--    "values", "signers": [{role, name, email, order}], "clauses", "answers", "language",
--    "sent_by", "idempotency_key"}
-- Answers: one per clause, `yes` or `no`; an `agree` clause must be `yes` (P0001 HINT `answers`).
create function public.start_client_consent_signing_for_service(
  p_token_hash bytea,
  p_first_name text,
  p_birth_year int,
  p_answers jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link record;
  v_req public.client_consent_requests%rowtype;
  v_client public.clients%rowtype;
  v_clause jsonb;
  v_answer text;
  v_sig record;
  v_signers jsonb;
  v_tz text;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  select * into v_link from private.clients_consent_link(p_token_hash);
  if v_link.link_id is null or not public.module_enabled_for_org(v_link.org_id, 'clients') then
    return '{"state": "invalid"}'::jsonb;
  end if;
  if not private.clients_consent_identity_ok(v_link.org_id, v_link.request_id, p_first_name, p_birth_year) then
    return private.clients_consent_identity_failed(v_link.org_id, v_link.signer_id);
  end if;
  select * into v_req from public.client_consent_requests r where r.id = v_link.request_id for update;

  if v_req.answers is null then
    if p_answers is null or pg_catalog.jsonb_typeof(p_answers) <> 'object' then
      raise exception 'Répondez à chaque question avant de signer.' using errcode = 'P0001', hint = 'answers';
    end if;
    for v_clause in select c from pg_catalog.jsonb_array_elements(v_req.clauses) c loop
      v_answer := p_answers ->> (v_clause ->> 'key');
      if v_answer is null or v_answer not in ('yes', 'no') then
        raise exception 'Répondez à chaque question avant de signer.' using errcode = 'P0001', hint = 'answers';
      end if;
      if v_clause ->> 'kind' = 'agree' and v_answer <> 'yes' then
        raise exception 'Pour signer ce consentement, vous devez accepter chaque clause marquée « Accord requis ».'
          using errcode = 'P0001', hint = 'answers';
      end if;
    end loop;
    if exists (select 1 from pg_catalog.jsonb_object_keys(p_answers) k
                where not exists (select 1 from pg_catalog.jsonb_array_elements(v_req.clauses) c where c ->> 'key' = k)) then
      raise exception 'Invalid answers' using errcode = '22023';
    end if;
    update public.client_consent_requests r set answers = p_answers, answered_at = pg_catalog.now()
     where r.id = v_req.id returning * into v_req;
  end if;

  -- An envelope already out: this signer resumes it.
  if not exists (select 1 from public.signature_requests s
                  where s.org_id = v_req.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                    and s.subject_id = v_req.id and s.status in ('draft', 'sent', 'viewed')) then
    -- Before any envelope: the signers must still be the ones the rules name (R-48), else the
    -- links are revoked and the clinic sends again; the text is the one published now.
    begin
      v_signers := private.clients_consent_signers(v_req.org_id, v_req.client_id);
    exception when others then
      v_signers := '[]'::jsonb;
    end;
    if pg_catalog.jsonb_array_length(v_signers)
         <> (select pg_catalog.count(*) from public.client_consent_request_signers x where x.request_id = v_req.id)
       or exists (select 1 from public.client_consent_request_signers x
                   where x.request_id = v_req.id
                     and not exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                                      where s ->> 'role' = x.role and (s ->> 'signer_client_id')::uuid = x.signer_client_id)) then
      perform private.clients_consent_close_links(v_req.org_id, v_req.id, null);
      return '{"state": "invalid"}'::jsonb;
    end if;
    update public.client_consent_requests r
       set template_version_id = v.id
      from public.document_templates t
      join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
     where r.id = v_req.id and t.org_id = r.org_id
       and t.key = 'clients.consent_' || r.consent_key || '_' || r.language
       and r.template_version_id <> v.id
    returning r.* into v_req;
    if v_req.id is null then
      select * into v_req from public.client_consent_requests r where r.id = v_link.request_id;
    end if;
  end if;
  select s.id, s.envelope_id, x.documenso_recipient_id into v_sig
    from public.signature_requests s
    join public.signature_request_signers x on x.request_id = s.id and x.role = v_link.role
   where s.org_id = v_req.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
     and s.subject_id = v_req.id and s.status in ('sent', 'viewed')
   order by s.created_at desc limit 1;
  if v_sig.id is not null and v_sig.envelope_id is not null and v_sig.documenso_recipient_id is not null then
    return pg_catalog.jsonb_build_object('state', 'resume', 'org_id', v_req.org_id, 'request_id', v_sig.id,
                                         'envelope_id', v_sig.envelope_id, 'recipient_id', v_sig.documenso_recipient_id);
  end if;

  select * into v_client from public.clients c where c.id = v_req.client_id;
  select o.timezone into v_tz from public.organizations o where o.id = v_req.org_id;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'role', s.role, 'name', c.first_name || ' ' || c.last_name, 'email', c.email,
           'order', case when s.role = 'client' then 1 else 2 end) order by s.role)
    into v_signers
    from public.client_consent_request_signers s
    join public.clients c on c.id = s.signer_client_id and c.org_id = s.org_id
   where s.request_id = v_req.id;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'email' is null) then
    raise exception 'La personne qui doit signer n''a pas d''adresse courriel : communiquez avec la clinique.'
      using errcode = 'P0001', hint = 'signer_email';
  end if;
  return pg_catalog.jsonb_build_object(
    'state', 'prepared',
    'org_id', v_req.org_id,
    'consent_request_id', v_req.id,
    'role', v_link.role,
    'template_version_id', v_req.template_version_id,
    'title', (select case when v_req.language = 'en' then t.name_en else t.name_fr end
                from public.client_consent_types t where t.org_id = v_req.org_id and t.key = v_req.consent_key)
             || ' — ' || v_client.first_name || ' ' || v_client.last_name,
    'values', pg_catalog.jsonb_build_object(
      'client', pg_catalog.jsonb_build_object('full_name', v_client.first_name || ' ' || v_client.last_name,
                                              'first_name', v_client.first_name),
      'signer', pg_catalog.jsonb_build_object('full_name', (select s ->> 'name' from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'role' = 'client')),
      'signer_2', pg_catalog.jsonb_build_object('full_name', (select s ->> 'name' from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'role' = 'client_2')),
      'today', (pg_catalog.now() at time zone v_tz)::date),
    'signers', v_signers,
    'clauses', v_req.clauses,
    'answers', v_req.answers,
    'language', v_req.language,
    'sent_by', v_req.requested_by,
    'idempotency_key', 'client-consent:' || v_req.id::text || ':' || p_idempotency_key);
end;
$$;

-- -----------------------------------------------------------------------------
-- The signature's outcome (core's capture: AFTER UPDATE OF status on signature_requests)
-- -----------------------------------------------------------------------------
-- Signed (the PDF stored): the request is signed, its consent in force replaces the previous one
-- (superseded), the links are revoked. Rejected → declined; expired → expired (links revoked).
-- Never fails the completion (the PDF's capture comes first, ADR 0005).
create function private.clients_mark_consent_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.client_consent_requests%rowtype;
  v_label text;
  v_signed timestamptz;
  v_by jsonb;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if new.subject_type <> 'client_consent_request' then
    return null;
  end if;
  begin
    select * into v_req from public.client_consent_requests r
     where r.org_id = new.org_id and r.id = new.subject_id for update;
    if v_req.id is null or v_req.state <> 'pending' then
      return null;
    end if;
    perform pg_catalog.set_config('app.audit_source', 'trigger:clients_consent_signature', true);
    if new.status = 'signed' then
      select 'v' || v.version into v_label from public.document_template_versions v where v.id = v_req.template_version_id;
      select max(x.signed_at) into v_signed from public.signature_request_signers x where x.request_id = new.id;
      v_signed := coalesce(v_signed, new.completed_at, pg_catalog.now());
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'name', c.first_name || ' ' || c.last_name, 'role', s.role,
               'relation', case when s.relation_id is null then null else 'parent_or_guardian' end) order by s.role), '[]')
        into v_by
        from public.client_consent_request_signers s join public.clients c on c.id = s.signer_client_id
       where s.request_id = v_req.id;
      update public.client_consents c set superseded_at = pg_catalog.now()
       where c.org_id = v_req.org_id and c.client_id = v_req.client_id and c.consent_key = v_req.consent_key
         and c.superseded_at is null and c.withdrawn_at is null;
      insert into public.client_consents
        (org_id, client_id, consent_key, language, template_version_id, version_label, signed_at, signed_by, answers,
         signed_file_id, request_id, source)
      values
        (v_req.org_id, v_req.client_id, v_req.consent_key, v_req.language, v_req.template_version_id,
         coalesce(v_label, 'v1'), v_signed, v_by, v_req.answers, new.signed_file_id, v_req.id, 'app');
      update public.client_consent_requests r set state = 'signed', signed_at = v_signed where r.id = v_req.id;
    elsif new.status = 'rejected' then
      update public.client_consent_requests r set state = 'declined' where r.id = v_req.id;
    elsif new.status = 'expired' then
      update public.client_consent_requests r set state = 'expired' where r.id = v_req.id;
    else
      return null;
    end if;
    perform private.clients_consent_close_links(v_req.org_id, v_req.id, null);
    perform private.expire_notifications(v_req.org_id, 'client_consent_request', v_req.id, array['clients.consent_overdue']);
    perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  exception when others then
    raise warning 'clients_mark_consent_signed: % (request %)', sqlstate, new.id;
  end;
  return null;
end;
$$;
revoke all on function private.clients_mark_consent_signed() from public, anon, authenticated, service_role;

create trigger signature_requests_clients_consent
  after update of status on public.signature_requests
  for each row
  when (old.status is distinct from new.status and new.purpose = 'clients.consent'
        and new.status in ('signed', 'rejected', 'expired'))
  execute function private.clients_mark_consent_signed();

-- -----------------------------------------------------------------------------
-- What a situation needs (Rendez-vous R1, Demandes D3; never blocks a booking, R-47)
-- -----------------------------------------------------------------------------
-- The active rules that apply: `general`, the service's code, the payer kind, the professional's
-- status, the situations given; each with its state for the client:
--   signed   a consent in force (not flagged for a new signature); for `each_time`, a request
--            signed for this context
--   resign   in force but flagged « À signer de nouveau » (R-49)
--   pending  a request is out
--   missing  none of the above
create function private.required_consents_for(
  p_org uuid,
  p_client_id uuid,
  p_service_code text default null,
  p_payer_kind text default null,
  p_professional_status text default null,
  p_situations text[] default '{}',
  p_context_type text default null,
  p_context_id uuid default null
)
returns table (consent_key text, frequency text, state text)
language sql
stable
set search_path = ''
as $$
  with applicable as (
    select r.consent_key, case when pg_catalog.bool_or(r.frequency = 'each_time') then 'each_time' else 'once' end as frequency
      from public.client_consent_rules r
      join public.client_consent_types t on t.org_id = r.org_id and t.key = r.consent_key and t.is_active
     where r.org_id = p_org and r.is_active
       and (r.trigger_kind = 'general'
            or (r.trigger_kind = 'service' and r.target = p_service_code)
            or (r.trigger_kind = 'payer_kind' and r.target = p_payer_kind)
            or (r.trigger_kind = 'professional_status' and r.target = p_professional_status)
            or (r.trigger_kind = 'situation' and r.target = any (coalesce(p_situations, '{}'))))
     group by r.consent_key
  )
  select a.consent_key, a.frequency,
         case
           when a.frequency = 'each_time' then
             case when exists (select 1 from public.client_consent_requests q
                                where q.org_id = p_org and q.client_id = p_client_id and q.consent_key = a.consent_key
                                  and q.state = 'signed' and q.context_type = p_context_type and q.context_id = p_context_id)
                  then 'signed'
                  when exists (select 1 from public.client_consent_requests q
                                where q.org_id = p_org and q.client_id = p_client_id and q.consent_key = a.consent_key
                                  and q.state = 'pending')
                  then 'pending'
                  else 'missing' end
           when exists (select 1 from public.client_consents c
                         where c.org_id = p_org and c.client_id = p_client_id and c.consent_key = a.consent_key
                           and c.superseded_at is null and c.withdrawn_at is null and c.resign_requested_at is null)
             then 'signed'
           when exists (select 1 from public.client_consent_requests q
                         where q.org_id = p_org and q.client_id = p_client_id and q.consent_key = a.consent_key
                           and q.state = 'pending')
             then 'pending'
           when exists (select 1 from public.client_consents c
                         where c.org_id = p_org and c.client_id = p_client_id and c.consent_key = a.consent_key
                           and c.superseded_at is null and c.withdrawn_at is null)
             then 'resign'
           else 'missing'
         end
    from applicable a
$$;
revoke all on function private.required_consents_for(uuid, uuid, text, text, text, text[], text, uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Read models: the states per client (staff), the provider's own clients, the list to obtain
-- -----------------------------------------------------------------------------
-- One row per client and consent with a consent or a request: the consent in force (signed,
-- resign, withdrawn) or the open request (pending, overdue). Staff (RLS of the tables).
-- The full join's sides may each be null: the columns come from the non-null side.
create view public.client_consents_status with (security_invoker = true) as
select coalesce(c.org_id, q.org_id) as org_id,
       coalesce(c.client_id, q.client_id) as client_id,
       coalesce(c.consent_key, q.consent_key) as consent_key,
       case when q.id is not null then case when q.due_at < pg_catalog.now() then 'overdue' else 'pending' end
            when c.withdrawn_at is not null then 'withdrawn'
            when c.resign_requested_at is not null then 'resign'
            else 'signed' end as state,
       c.version_label, c.signed_at, q.id as request_id, q.due_at, q.last_sent_at
  from (select distinct on (k.org_id, k.client_id, k.consent_key) k.*
          from public.client_consents k
         where k.superseded_at is null
         order by k.org_id, k.client_id, k.consent_key, k.withdrawn_at nulls first, k.signed_at desc) c
  full join (select r.* from public.client_consent_requests r where r.state = 'pending') q
    on q.org_id = c.org_id and q.client_id = c.client_id and q.consent_key = c.consent_key;
revoke all on public.client_consents_status from anon, authenticated;
grant select on public.client_consents_status to authenticated;

-- « Consentements à obtenir »: the open requests with the client's name and the consent's.
create view public.client_consents_to_obtain with (security_invoker = true) as
select r.org_id, r.id as request_id, r.client_id, c.first_name || ' ' || c.last_name as client_name,
       c.primary_professional_id, r.consent_key, t.name_fr as consent_name, r.language, r.due_at,
       r.due_at is not null and r.due_at < pg_catalog.now() as is_overdue,
       r.created_at, r.last_sent_at, r.reminded_at, r.answered_at is not null as answered,
       (select s.status from public.signature_requests s
         where s.org_id = r.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
           and s.subject_id = r.id order by s.created_at desc limit 1) as signing_status
  from public.client_consent_requests r
  join public.clients c on c.id = r.client_id and c.org_id = r.org_id
  join public.client_consent_types t on t.org_id = r.org_id and t.key = r.consent_key
 where r.state = 'pending';
revoke all on public.client_consents_to_obtain from anon, authenticated;
grant select on public.client_consents_to_obtain to authenticated;

-- The professional's own clients' consent states (clients.self; CL-5: no policy on client tables).
create function private.my_client_consents_rows()
returns table (client_id uuid, consent_key text, state text, signed_at timestamptz, due_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pro uuid := private.current_professional_id();
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('clients.self') or v_pro is null then
    return;
  end if;
  return query
    select s.client_id, s.consent_key, s.state, s.signed_at, s.due_at
      from (select coalesce(c.client_id, q.client_id) as client_id,
                   coalesce(c.consent_key, q.consent_key) as consent_key,
                   case when q.id is not null then case when q.due_at < pg_catalog.now() then 'overdue' else 'pending' end
                        when c.withdrawn_at is not null then 'withdrawn'
                        when c.resign_requested_at is not null then 'resign'
                        else 'signed' end as state,
                   c.signed_at, q.due_at
              from (select distinct on (k.client_id, k.consent_key) k.*
                      from public.client_consents k
                     where k.org_id = v_org and k.superseded_at is null
                     order by k.client_id, k.consent_key, k.withdrawn_at nulls first, k.signed_at desc) c
              full join (select r.* from public.client_consent_requests r where r.org_id = v_org and r.state = 'pending') q
                on q.client_id = c.client_id and q.consent_key = c.consent_key) s
     where private.client_visible_to_professional(s.client_id, v_pro);
end;
$$;
revoke all on function private.my_client_consents_rows() from public, anon;
grant execute on function private.my_client_consents_rows() to authenticated;

create view public.my_client_consents with (security_invoker = true) as
select r.client_id, r.consent_key, r.state, r.signed_at, r.due_at from private.my_client_consents_rows() r;
revoke all on public.my_client_consents from anon, authenticated;
grant select on public.my_client_consents to authenticated;

-- -----------------------------------------------------------------------------
-- The reminder job (function clients-consent-reminders, daily at 8 h clinic time)
-- -----------------------------------------------------------------------------
-- The pending requests to send again (last sent reminder_days ago or more, not reminded yet), at
-- most p_limit; and, in the same call, one notice per overdue request for clients.manage
-- (dedupe per request: raised once). Returns { remind: [request_id…], overdue: n }.
create function public.client_consent_reminders_for_service(p_org_id uuid, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days int;
  v_ids uuid[];
  v_count int := 0;
  v_overdue uuid;
begin
  if p_org_id is null or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  select s.reminder_days into v_days from public.client_consent_settings s where s.org_id = p_org_id;
  v_days := coalesce(v_days, 7);
  -- A file archived or anonymised since: its open requests end (cancelled, no actor), links revoked.
  for v_overdue in
    update public.client_consent_requests r
       set state = 'cancelled', cancelled_at = pg_catalog.now()
      from public.clients c
     where r.org_id = p_org_id and r.state = 'pending' and c.org_id = r.org_id and c.id = r.client_id
       and (c.archived_at is not null or c.anonymized_at is not null)
    returning r.id
  loop
    perform private.clients_consent_close_links(p_org_id, v_overdue, null);
  end loop;
  -- P3-40: nothing is sent again while the module is reserved for its testers.
  if not public.module_open_to_all_for_org(p_org_id, 'clients') then
    return pg_catalog.jsonb_build_object('remind', '[]'::jsonb, 'overdue', 0);
  end if;
  -- Claimed here (reminded_at set): a re-send that fails is not tried again every day.
  with due as (
    select r.id from public.client_consent_requests r
     where r.org_id = p_org_id and r.state = 'pending' and r.reminded_at is null
       and r.last_sent_at <= pg_catalog.now() - pg_catalog.make_interval(days => v_days)
       and not exists (select 1 from public.signature_requests s
                        where s.org_id = r.org_id and s.purpose = 'clients.consent'
                          and s.subject_type = 'client_consent_request' and s.subject_id = r.id
                          and s.status in ('draft', 'sent', 'viewed'))
     order by r.last_sent_at limit p_limit
     for update skip locked
  ), claimed as (
    update public.client_consent_requests r set reminded_at = pg_catalog.now()
      from due where r.id = due.id
    returning r.id
  )
  select coalesce(pg_catalog.array_agg(claimed.id), '{}') into v_ids from claimed;
  for v_overdue in
    select q.id from public.client_consent_requests q
     where q.org_id = p_org_id and q.state = 'pending' and q.due_at is not null and q.due_at < pg_catalog.now()
  loop
    perform private.notify(
      p_org_id, 'clients', 'clients.consent_overdue', 'normal', 'Consentement à obtenir',
      'Un consentement demandé n''est pas encore signé et sa date limite est passée.',
      '/clients/consentements', 'client_consent_request', v_overdue, 'clients.manage', null,
      'consent_overdue:' || v_overdue::text, pg_catalog.now() + interval '30 days');
    v_count := v_count + 1;
  end loop;
  return pg_catalog.jsonb_build_object('remind', pg_catalog.to_jsonb(v_ids), 'overdue', v_count);
end;
$$;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('clients.consent_reminders', 'clients', 'Rappels de consentement',
   'Renvoie une fois les demandes de consentement en attente depuis le délai réglé, et signale celles dont la date limite est passée.',
   'function', 'clients-consent-reminders', null, 'clients.consent_reminders', 8, false)
on conflict do nothing;

select cron.schedule('clients.consent_reminders', '5 * * * *',
  $$select private.invoke_job_function('clients.consent_reminders')$$);

-- -----------------------------------------------------------------------------
-- Import (I1): a consent fact from GOrendezvous (no PDF)
-- -----------------------------------------------------------------------------
-- Records a consent signed in GOrendezvous at its own version (R-49: counts as signed). Skipped
-- (false) when the client already has a consent in force for it. Service role.
create function public.import_client_consent_fact_for_service(
  p_org_id uuid,
  p_client_id uuid,
  p_consent_key text,
  p_version_label text,
  p_signed_at timestamptz,
  p_signer_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lang text;
  v_count int;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if p_org_id is null or p_client_id is null or p_signed_at is null then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  select c.language into v_lang from public.clients c where c.org_id = p_org_id and c.id = p_client_id;
  if v_lang is null then
    raise exception 'Client introuvable.' using errcode = 'P0001', hint = 'client';
  end if;
  if not exists (select 1 from public.client_consent_types t where t.org_id = p_org_id and t.key = p_consent_key) then
    raise exception 'Ce consentement n''existe pas.' using errcode = 'P0001', hint = 'consent_key';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'import:gorendezvous', true);
  insert into public.client_consents (org_id, client_id, consent_key, language, version_label, signed_at, signed_by, source)
  values (p_org_id, p_client_id, p_consent_key, v_lang, coalesce(nullif(pg_catalog.btrim(p_version_label), ''), 'GOrendezvous'),
          p_signed_at,
          case when nullif(pg_catalog.btrim(coalesce(p_signer_name, '')), '') is null then '[]'::jsonb
               else pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name', pg_catalog.btrim(p_signer_name))) end,
          'import')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return v_count > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  public.set_client_consent_rule(uuid, text, text, text, text, boolean),
  public.set_client_consent_settings(jsonb),
  public.cancel_client_consent_request(uuid),
  public.publish_client_consent_version(uuid, text),
  public.prepare_client_consent_request_for_service(uuid, uuid, uuid, text, text, uuid, timestamptz, bytea, bytea, uuid),
  public.open_client_consent_for_service(bytea, text, int),
  public.start_client_consent_signing_for_service(bytea, text, int, jsonb, text),
  public.client_consent_reminders_for_service(uuid, int),
  public.import_client_consent_fact_for_service(uuid, uuid, text, text, timestamptz, text)
from public, anon, authenticated;

grant execute on function
  public.set_client_consent_rule(uuid, text, text, text, text, boolean),
  public.set_client_consent_settings(jsonb),
  public.cancel_client_consent_request(uuid),
  public.publish_client_consent_version(uuid, text)
to authenticated;

grant execute on function
  public.prepare_client_consent_request_for_service(uuid, uuid, uuid, text, text, uuid, timestamptz, bytea, bytea, uuid),
  public.open_client_consent_for_service(bytea, text, int),
  public.start_client_consent_signing_for_service(bytea, text, int, jsonb, text),
  public.client_consent_reminders_for_service(uuid, int),
  public.import_client_consent_fact_for_service(uuid, uuid, text, text, timestamptz, text)
to service_role;

revoke execute on function
  public.set_client_consent_rule(uuid, text, text, text, text, boolean),
  public.set_client_consent_settings(jsonb),
  public.cancel_client_consent_request(uuid),
  public.publish_client_consent_version(uuid, text)
from service_role;
