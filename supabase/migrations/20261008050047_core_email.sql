-- =============================================================================
-- Email: template catalogue, per-clinic overrides, sender settings and send log
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §2.2–§2.5
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.6 (P3-5, P3-6, P3-18,
--          P3-20, P3-21, P3-26)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * `email_template_defaults` is a global catalogue seeded by migrations (like `permissions`:
--   not audited, git is its history). Modules seed their own `<module>.<name>` keys. Each row
--   carries its variables, its `view_permission` (copied onto every log row) and the P3-18 flags
--   (`recipient_mode`, `allows_attachments`, enforced by _shared/email/send.ts). Checks keep the
--   catalogue sound: the key prefix is the module, the variables are well formed, and the
--   default text uses only declared placeholders.
-- * The effective template is the clinic's override (`email_templates`, audited) or else the
--   default. `version` is 0 for the default and counts the saves of an override from 1. A
--   (template_key, template_version) pair is never reused within an org, so an `email_log` row
--   always names one text (its before/after is in the audit trail): a reset deletes the
--   override but not its counter (`email_template_versions.last_version`), and the next save
--   continues from the highest version used (saves 1, 2, reset, save → 3).
-- * Placeholders follow one rule, shared with the renderer (`PLACEHOLDER_SOURCE`,
--   supabase/functions/_shared/format.ts): `\{\{([^{}\r\n]*)\}\}`, the path being the capture
--   with spaces trimmed (btrim: SQL is at most stricter than the renderer's trim()). The one
--   repeated class stops at the next brace, so matching is linear (a lone `{{` followed by
--   10 000 spaces is refused at once). Any `{{` or `}}` left after removing the placeholders is
--   « unclosed ». Subject, body and button label are checked joined by line breaks, which no
--   placeholder may cross.
-- * `email_settings`: one row per clinic (an `organizations` insert trigger, plus the backfill
--   below). Its own table because its permissions differ from `organizations`: the sender with
--   `settings.email_manage`, the sending domain with `settings.integrations_manage`. Both
--   addresses must be one bare mailbox (`private.is_mailbox`: no display name, no second
--   address, no space or `<>,` in the local part; an ASCII domain), a subset of what the send
--   path accepts, so a stored sender is never refused there. `from_address` must be on
--   `sending_domain`. The sender name cannot hold `<`, `>`, `"` or control characters (it goes
--   into the From header); seeded from the org name without them, « Clinique » if nothing is
--   left. With no `reply_to`, get_email_context answers the org email when it is one mailbox.
-- * `email_log` is an operational log (no audit trigger, 000_invariants list): one row per
--   message, written only by the service-role RPCs below. No body, rendered subject or value
--   is stored (design §2.5). Read through RLS: own org, and the row's `view_permission`
--   (tested against the caller's permission array once per statement, P3-21) or
--   `settings.email_manage`. A disabled module's `view_permission` drops out of the array, so
--   its rows disappear except for `settings.email_manage` holders (the clinic-wide history).
-- * Efficiency. list_email_log is keyset-paged on (created_at, id); the paging position and
--   the period are computed into variables first, so on any page (generic plan included) they
--   are index bounds of `email_log_org_created_idx`, or of `email_log_org_status_idx` with a
--   status filter (« Échecs » is a rare status: without it a filter matching nothing would read
--   the whole org). count_org_emails_today is a closed range on the clinic day. Measured
--   over 2 × 12 000 rows: see the functions.
-- * Status order: queued < sent < delivery_delayed < delivered; bounced and complained are
--   final, and so is failed, except `failed / provider_unavailable` (outcome unknown: a timeout
--   or network error on the last attempt, or a row stuck in `queued`). A later webhook (or a late
--   mark_email_sent) may move that one on, so a delivered email is never shown as failed and
--   « Renvoyer » does not resend it. A late mark_email_failed never overrides a webhook outcome.
--   The provider's own failure event (Resend `email.failed`: invalid recipient, domain or quota)
--   is `failed / provider_failed`, final; it moves a row not yet delivered (queued, sent,
--   delivery_delayed, unknown outcome), never a delivered, bounced or complained one.
-- * Jobs (Task 3.3 runner): `core.email_log_retention` nulls `to_email` after 24 months (P3-6),
--   in batches of 5 000 so each statement stays bounded; `core.email_log_stale_queued` fails
--   rows still `queued` after 15 minutes as `provider_unavailable` (a function killed between
--   queue and mark), every 5 minutes.
-- * Send-path contract (supabase/functions/_shared/email/send.ts, lane F): `get_email_context`,
--   `queue_email`, `mark_email_sent`, `mark_email_failed`, all service-role only, exactly as
--   that file assumes. queue_email takes the version and view permission from that context
--   and refuses (22023) any that differ from the catalogue and the org's current version (a
--   save between the two calls fails that send rather than log the wrong version).
--   `apply_email_event` (resend-webhook, Task 3.10) checks the row's module itself and answers
--   `ignored` when it is disabled, or when the tag and the provider id name two different rows
--   (a 23505 there would make the provider retry forever), so the webhook acks without an
--   extra call.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_email', true);

-- -----------------------------------------------------------------------------
-- Validation helpers (immutable; used by checks and RPCs, callable by no client role)
-- -----------------------------------------------------------------------------
-- One bare mailbox: `local@domain.tld`, at most 254 characters. The local part is RFC atext
-- and dots (no space, control character, `<>()[]\,;:"` or `@`); the domain is ASCII labels
-- (an internationalised one as punycode) ending in a letter TLD or `xn--…`.
create function private.is_mailbox(p_address text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.length(p_address) <= 254
     and p_address ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$'
$$;

-- A catalogue `variables` array: at most 40 objects `{path, label, sample, required, kind}`
-- with distinct dot paths of lowercase identifiers.
create function private.email_variables_valid(p_variables jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_variables) is distinct from 'array' then false
    when pg_catalog.jsonb_array_length(p_variables) > 40 then false
    else not exists (
           select 1 from pg_catalog.jsonb_array_elements(p_variables) v
            where pg_catalog.jsonb_typeof(v) <> 'object'
               or pg_catalog.jsonb_typeof(v -> 'path') is distinct from 'string'
               or (v ->> 'path') !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
               or pg_catalog.jsonb_typeof(v -> 'label') is distinct from 'string'
               or pg_catalog.jsonb_typeof(v -> 'sample') is distinct from 'string'
               or pg_catalog.jsonb_typeof(v -> 'required') is distinct from 'boolean'
               or (v ->> 'kind') is null
               or (v ->> 'kind') not in ('text', 'date', 'datetime', 'url'))
         and (select pg_catalog.count(distinct v ->> 'path') = pg_catalog.count(*)
                from pg_catalog.jsonb_array_elements(p_variables) v)
  end
$$;

-- The declared paths of a `variables` array ('{}' for anything else).
create function private.email_variable_paths(p_variables jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(v ->> 'path'), '{}')
    from pg_catalog.jsonb_array_elements(
           case when pg_catalog.jsonb_typeof(p_variables) = 'array' then p_variables else '[]' end) v
$$;

-- The French P0001 message for a text whose placeholders break the rule (header), or null:
-- the first undeclared placeholder, else any `{{` / `}}` left once the placeholders are removed.
create function private.email_placeholder_error(p_text text, p_paths text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select 'Variable inconnue : {{' || pg_catalog.left(m.path, 80) || '}}'
       from (select pg_catalog.btrim(r.match[1]) as path, r.ord
               from pg_catalog.regexp_matches(p_text, '\{\{([^{}\r\n]*)\}\}', 'g')
                    with ordinality as r(match, ord)) m
      where not (m.path = any (coalesce(p_paths, '{}')))
      order by m.ord
      limit 1),
    (select 'Accolades non fermées dans le texte.'
       from (select pg_catalog.regexp_replace(p_text, '\{\{([^{}\r\n]*)\}\}', '', 'g') as rest) x
      where pg_catalog.strpos(x.rest, '{{') > 0 or pg_catalog.strpos(x.rest, '}}') > 0))
$$;

-- A sender name from an org name: without the characters the From header refuses, runs of
-- spaces collapsed, at most 80 characters; « Clinique » when nothing is left.
create function private.email_sender_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(p_name, '[[:cntrl:]<>"]', '', 'g'), ' {2,}', ' ', 'g')), 80)), ''),
    'Clinique')
$$;

revoke all on function
  private.is_mailbox(text),
  private.email_variables_valid(jsonb),
  private.email_variable_paths(jsonb),
  private.email_placeholder_error(text, text[]),
  private.email_sender_name(text)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Template catalogue
-- -----------------------------------------------------------------------------
create table public.email_template_defaults (
  key text primary key check (key ~ '^[a-z_]+\.[a-z0-9_]+$'),
  module_key text not null references public.modules(key),
  label text not null check (pg_catalog.length(pg_catalog.btrim(label)) between 1 and 120),
  description text not null,
  -- « Pourquoi ce courriel », printed in the footer.
  why_line text not null check (pg_catalog.length(pg_catalog.btrim(why_line)) between 1 and 300),
  subject text not null check (pg_catalog.length(subject) between 1 and 200 and subject !~ '[\r\n]'),
  body text not null check (pg_catalog.length(body) between 1 and 10000),
  button_label text check (pg_catalog.length(button_label) between 1 and 60),
  variables jsonb not null default '[]' check (private.email_variables_valid(variables)),
  view_permission text not null references public.permissions(key),
  recipient_mode text not null default 'subject' check (recipient_mode in ('subject', 'free')),
  allows_attachments boolean not null default false,
  updated_at timestamptz not null default now(),
  -- `<module>.<name>`, like permission keys.
  check (pg_catalog.split_part(key, '.', 1) = module_key),
  -- The default text uses only the placeholders it declares.
  check (private.email_placeholder_error(
           subject || E'\n' || body || E'\n' || coalesce(button_label, ''),
           private.email_variable_paths(variables)) is null)
);
create index email_template_defaults_module_key_idx on public.email_template_defaults (module_key);
create index email_template_defaults_view_permission_idx on public.email_template_defaults (view_permission);

create trigger email_template_defaults_set_updated_at
  before update on public.email_template_defaults
  for each row execute function private.set_updated_at();

alter table public.email_template_defaults enable row level security;
revoke all on public.email_template_defaults from anon, authenticated;
grant select on public.email_template_defaults to authenticated;
create policy email_template_defaults_select on public.email_template_defaults
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Per-clinic overrides
-- -----------------------------------------------------------------------------
create table public.email_templates (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null references public.email_template_defaults(key),
  subject text not null check (pg_catalog.length(subject) between 1 and 200 and subject !~ '[\r\n]'),
  body text not null check (pg_catalog.length(body) between 1 and 10000),
  button_label text check (pg_catalog.length(button_label) between 1 and 60),
  version int not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  primary key (org_id, key)
);
create index email_templates_key_idx on public.email_templates (key);
create index email_templates_updated_by_idx on public.email_templates (updated_by);

create trigger email_templates_set_updated_at
  before update on public.email_templates
  for each row execute function private.set_updated_at();
create trigger email_templates_audit
  after insert or update or delete on public.email_templates
  for each row execute function private.audit_trigger();

alter table public.email_templates enable row level security;
revoke all on public.email_templates from anon, authenticated;
grant select on public.email_templates to authenticated;
create policy email_templates_select on public.email_templates
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('settings.view'))
  );

-- The highest override version an org has used per template, kept across resets so that a
-- version number is never reused (header). Written only by save_email_template (definer);
-- no client privilege, no policy. Audited like every org-scoped table.
create table public.email_template_versions (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null references public.email_template_defaults(key),
  last_version int not null check (last_version > 0),
  primary key (org_id, key)
);
create index email_template_versions_key_idx on public.email_template_versions (key);

create trigger email_template_versions_audit
  after insert or update or delete on public.email_template_versions
  for each row execute function private.audit_trigger();

alter table public.email_template_versions enable row level security;
revoke all on public.email_template_versions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Sender settings
-- -----------------------------------------------------------------------------
create table public.email_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  from_name text not null check (pg_catalog.length(from_name) between 1 and 80 and from_name !~ '[[:cntrl:]<>"]'),
  from_address text not null,
  reply_to text check (private.is_mailbox(reply_to)),
  sending_domain text not null default 'gestion.cliniquemana.com'
    check (pg_catalog.length(sending_domain) <= 253
           and sending_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint email_settings_from_address_check check (
    private.is_mailbox(from_address) and pg_catalog.split_part(from_address, '@', 2) = sending_domain)
);
create index email_settings_updated_by_idx on public.email_settings (updated_by);

create trigger email_settings_set_updated_at
  before update on public.email_settings
  for each row execute function private.set_updated_at();
create trigger email_settings_audit
  after insert or update or delete on public.email_settings
  for each row execute function private.audit_trigger();

alter table public.email_settings enable row level security;
revoke all on public.email_settings from anon, authenticated;
grant select on public.email_settings to authenticated;
create policy email_settings_select on public.email_settings
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('settings.view'))
  );

-- A new org gets its sender: its name (private.email_sender_name), the no-reply address of the
-- default domain, and its email as reply-to when it is one mailbox.
create function private.seed_org_email_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_settings (org_id, from_name, from_address, reply_to)
  values (
    new.id,
    private.email_sender_name(new.name),
    'no-reply@gestion.cliniquemana.com',
    case when private.is_mailbox(new.email) then new.email end)
  on conflict do nothing;
  return null;
end;
$$;

revoke all on function private.seed_org_email_settings() from public, anon, authenticated, service_role;

create trigger organizations_seed_email_settings
  after insert on public.organizations
  for each row execute function private.seed_org_email_settings();

-- Backfill (staging): the same row for every existing org, audited as this migration.
insert into public.email_settings (org_id, from_name, from_address, reply_to)
select o.id,
       private.email_sender_name(o.name),
       'no-reply@gestion.cliniquemana.com',
       case when private.is_mailbox(o.email) then o.email end
  from public.organizations o
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Send log
-- -----------------------------------------------------------------------------
create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- The template's module (the webhook's module gate); always the key prefix.
  module_key text not null,
  template_key text not null references public.email_template_defaults(key),
  template_version int not null check (template_version >= 0),
  -- Null once anonymised (24 months, core.email_log_retention).
  to_email text check (pg_catalog.length(to_email) between 3 and 254 and pg_catalog.strpos(to_email, '@') > 1),
  to_profile_id uuid references public.profiles(user_id) on delete set null,
  -- The record the email is about (`staff_invitation`, `professional`, …): its timeline.
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  subject_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed')),
  -- A code, never a provider message (which can quote the address).
  error_code text check (error_code ~ '^[a-z0-9_]{1,64}$'),
  attempts int not null default 0 check (attempts between 0 and 100),
  -- The provider's message id (Resend; Mailpit or console locally).
  resend_id text unique check (pg_catalog.length(resend_id) between 1 and 200),
  view_permission text not null references public.permissions(key),
  attachment_count smallint not null default 0 check (attachment_count between 0 and 3),
  sent_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_event_at timestamptz,
  check (pg_catalog.split_part(template_key, '.', 1) = module_key),
  check ((status = 'failed') = (error_code is not null))
);
-- Serves the org FK, the RLS predicate, list_email_log (keyset on created_at, id) and
-- count_org_emails_today.
create index email_log_org_created_idx on public.email_log (org_id, created_at desc, id desc);
-- Serves list_email_log with a status (« Échecs », a rare status: the org index would read
-- every row of the org to find none).
create index email_log_org_status_idx on public.email_log (org_id, status, created_at desc, id desc);
-- Serves list_subject_emails (record timelines, P3-26).
create index email_log_subject_idx on public.email_log (org_id, subject_type, subject_id, created_at desc, id desc);
-- Serves core.email_log_retention.
create index email_log_retention_idx on public.email_log (created_at) where to_email is not null;
-- Serves core.email_log_stale_queued.
create index email_log_queued_idx on public.email_log (created_at) where status = 'queued';
create index email_log_template_key_idx on public.email_log (template_key);
create index email_log_to_profile_id_idx on public.email_log (to_profile_id);
create index email_log_sent_by_idx on public.email_log (sent_by);
create index email_log_view_permission_idx on public.email_log (view_permission);

alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;
grant select on public.email_log to authenticated;
create policy email_log_select on public.email_log
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (view_permission = any ((select private.current_permission_keys())::text[])
         or (select private.has_permission('settings.email_manage')))
  );

-- -----------------------------------------------------------------------------
-- User RPCs (« Courriels », Task 3.11)
-- -----------------------------------------------------------------------------
-- Sets the sender of the caller's org. The address is lowercased and must be on the sending
-- domain (email_settings_from_address_check, 23514); an empty reply-to clears it.
create function public.set_email_sender(p_from_name text, p_from_address text, p_reply_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(p_from_name, E' \t\r\n');
begin
  if not private.has_permission('settings.email_manage') then
    raise exception 'Permission refusée : settings.email_manage' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.length(v_name), 0) not between 1 and 80 then
    raise exception 'Le nom d''expéditeur doit compter de 1 à 80 caractères.' using errcode = 'P0001';
  end if;
  if v_name ~ '[[:cntrl:]<>"]' then
    raise exception 'Le nom d''expéditeur ne peut pas contenir les caractères < > ou ".' using errcode = 'P0001';
  end if;

  update public.email_settings s
     set from_name = v_name,
         from_address = pg_catalog.lower(pg_catalog.btrim(p_from_address, E' \t\r\n')),
         reply_to = nullif(pg_catalog.btrim(p_reply_to, E' \t\r\n'), ''),
         updated_by = auth.uid()
   where s.org_id = private.current_user_org_id();
end;
$$;

-- Changes the sending domain of the caller's org and moves the from address onto it in the
-- same update, so email_settings_from_address_check holds.
create function public.set_email_sending_domain(p_domain text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := pg_catalog.lower(pg_catalog.btrim(p_domain, E' \t\r\n'));
begin
  if not private.has_permission('settings.integrations_manage') then
    raise exception 'Permission refusée : settings.integrations_manage' using errcode = '42501';
  end if;
  if v_domain is null or pg_catalog.length(v_domain) > 253
     or v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$' then
    raise exception 'Domaine d''envoi invalide.' using errcode = 'P0001';
  end if;

  update public.email_settings s
     set sending_domain = v_domain,
         from_address = pg_catalog.split_part(s.from_address, '@', 1) || '@' || v_domain,
         updated_by = auth.uid()
   where s.org_id = private.current_user_org_id();
end;
$$;

-- The effective templates of the caller's org (core and enabled modules), in one query.
create function public.list_email_templates()
returns table (
  key text,
  module_key text,
  label text,
  description text,
  is_custom boolean,
  version int,
  updated_at timestamptz,
  updated_by_name text,
  subject text,
  body text,
  button_label text,
  variables jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('settings.view') then
    raise exception 'Permission refusée : settings.view' using errcode = '42501';
  end if;
  return query
    select d.key, d.module_key, d.label, d.description,
           t.org_id is not null, coalesce(t.version, 0), t.updated_at, p.display_name,
           coalesce(t.subject, d.subject), coalesce(t.body, d.body),
           case when t.org_id is null then d.button_label else t.button_label end,
           d.variables
      from public.email_template_defaults d
      left join public.email_templates t on t.org_id = v_org and t.key = d.key
      left join public.profiles p on p.user_id = t.updated_by
     where public.module_enabled_for_org(v_org, d.module_key)
     order by d.module_key <> 'core', d.module_key, d.label;
end;
$$;

-- Saves the caller's org override of a template (trimmed, validated) as its next version.
create function public.save_email_template(p_key text, p_subject text, p_body text, p_button_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_default public.email_template_defaults%rowtype;
  v_subject text := pg_catalog.btrim(p_subject, E' \t\r\n');
  v_body text := pg_catalog.btrim(p_body, E' \t\r\n');
  v_button text := nullif(pg_catalog.btrim(p_button_label, E' \t\r\n'), '');
  v_error text;
  v_version int;
begin
  if not private.has_permission('settings.email_manage') then
    raise exception 'Permission refusée : settings.email_manage' using errcode = '42501';
  end if;
  select * into v_default from public.email_template_defaults d where d.key = p_key;
  if not found or not public.module_enabled_for_org(v_org, v_default.module_key) then
    raise exception 'Modèle inconnu : %', p_key using errcode = '22023';
  end if;

  if coalesce(v_subject, '') = '' then
    raise exception 'L''objet est obligatoire.' using errcode = 'P0001';
  end if;
  if pg_catalog.length(v_subject) > 200 then
    raise exception 'L''objet ne peut pas dépasser 200 caractères.' using errcode = 'P0001';
  end if;
  if v_subject ~ '[\r\n]' then
    raise exception 'L''objet doit tenir sur une seule ligne.' using errcode = 'P0001';
  end if;
  if coalesce(v_body, '') = '' then
    raise exception 'Le texte est obligatoire.' using errcode = 'P0001';
  end if;
  if pg_catalog.length(v_body) > 10000 then
    raise exception 'Le texte ne peut pas dépasser 10 000 caractères.' using errcode = 'P0001';
  end if;
  if pg_catalog.length(v_button) > 60 then
    raise exception 'Le libellé du bouton ne peut pas dépasser 60 caractères.' using errcode = 'P0001';
  end if;
  v_error := private.email_placeholder_error(
    v_subject || E'\n' || v_body || E'\n' || coalesce(v_button, ''),
    private.email_variable_paths(v_default.variables));
  if v_error is not null then
    raise exception '%', v_error using errcode = 'P0001';
  end if;

  -- The next version: one more than the highest ever used, reset or not. The counter's row
  -- lock serialises two saves of the same template.
  insert into public.email_template_versions as c (org_id, key, last_version)
  values (v_org, p_key, 1)
  on conflict (org_id, key) do update set last_version = c.last_version + 1
  returning c.last_version into v_version;

  insert into public.email_templates as t (org_id, key, subject, body, button_label, version, updated_by)
  values (v_org, p_key, v_subject, v_body, v_button, v_version, auth.uid())
  on conflict (org_id, key) do update
    set subject = excluded.subject,
        body = excluded.body,
        button_label = excluded.button_label,
        version = excluded.version,
        updated_by = excluded.updated_by;
end;
$$;

-- « Rétablir le texte par défaut »: deletes the caller's org override (audited). Its version
-- counter stays, so the next save does not reuse a version number.
create function public.reset_email_template(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_module text;
begin
  if not private.has_permission('settings.email_manage') then
    raise exception 'Permission refusée : settings.email_manage' using errcode = '42501';
  end if;
  select d.module_key into v_module from public.email_template_defaults d where d.key = p_key;
  if not found or not public.module_enabled_for_org(v_org, v_module) then
    raise exception 'Modèle inconnu : %', p_key using errcode = '22023';
  end if;
  delete from public.email_templates t where t.org_id = v_org and t.key = p_key;
end;
$$;

-- « Historique d'envoi »: the log rows the caller may see (RLS applies), newest first,
-- keyset-paged on (created_at, id): pass the last row's created_at and id. Filters are
-- optional; the period is [p_from, p_to).
-- The cursor and the period are folded into two variables first: the upper bound is the
-- smaller of the cursor and (p_to, nil uuid), the lower one p_from. A plpgsql variable is a
-- plan parameter, so both stay index bounds in a generic plan (a `p is null or …` term would
-- only be a filter). With a status the query reads `email_log_org_status_idx`, so a filter
-- matching nothing reads nothing. The template filter is a filter (a template is a large
-- share of an org's rows, its own index would add little).
-- Measured, generic plan, 12 000 rows in each of two orgs (auto_explain, local): any page
-- reads its 50 index entries, 10 000 rows deep included (0.4 ms; the SQL version read and
-- filtered 10 051, 2.1 ms); a status matching nothing reads none (was all 12 000).
create function public.list_email_log(
  p_template_key text default null,
  p_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before timestamptz default null,
  p_limit int default 50,
  p_before_id uuid default null
)
returns table (
  id uuid,
  template_key text,
  template_label text,
  status text,
  to_email text,
  subject_type text,
  subject_id uuid,
  created_at timestamptz,
  sent_at timestamptz,
  last_event_at timestamptz,
  error_code text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- No cursor: (infinity, max uuid). A cursor without an id: the nil uuid (the smallest),
  -- i.e. `created_at < p_before`. `created_at < p_to` is `(created_at, id) < (p_to, nil)`.
  v_before timestamptz := coalesce(p_before, 'infinity');
  v_before_id uuid := coalesce(p_before_id,
                               case when p_before is null then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
                                    else '00000000-0000-0000-0000-000000000000'::uuid end);
  v_from timestamptz := coalesce(p_from, '-infinity');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if p_to is not null and (p_to, '00000000-0000-0000-0000-000000000000'::uuid) < (v_before, v_before_id) then
    v_before := p_to;
    v_before_id := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;

  if p_status is null then
    return query
    select e.id, e.template_key, d.label, e.status, e.to_email, e.subject_type, e.subject_id,
           e.created_at, e.sent_at, e.last_event_at, e.error_code
      from public.email_log e
      join public.email_template_defaults d on d.key = e.template_key
     where e.org_id = (select private.current_user_org_id())
       and (e.created_at, e.id) < (v_before, v_before_id)
       and e.created_at >= v_from
       and (p_template_key is null or e.template_key = p_template_key)
     order by e.created_at desc, e.id desc
     limit v_limit;
  else
    return query
    select e.id, e.template_key, d.label, e.status, e.to_email, e.subject_type, e.subject_id,
           e.created_at, e.sent_at, e.last_event_at, e.error_code
      from public.email_log e
      join public.email_template_defaults d on d.key = e.template_key
     where e.org_id = (select private.current_user_org_id())
       and e.status = p_status
       and (e.created_at, e.id) < (v_before, v_before_id)
       and e.created_at >= v_from
       and (p_template_key is null or e.template_key = p_template_key)
     order by e.created_at desc, e.id desc
     limit v_limit;
  end if;
end;
$$;

-- A record's emails (« Historique » timelines, P3-26), newest first, with who sent each one.
-- Definer so that the sender's name shows to anyone who may see the email (profiles are
-- readable with users.view only); the rows are exactly those of the email_log_select policy:
-- own org, and the row's view_permission or settings.email_manage.
create function public.list_subject_emails(p_subject_type text, p_subject_id uuid, p_limit int default 50)
returns table (
  id uuid,
  template_key text,
  template_label text,
  status text,
  to_email text,
  sent_by uuid,
  sent_by_name text,
  created_at timestamptz,
  sent_at timestamptz,
  last_event_at timestamptz,
  error_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.template_key, d.label, e.status, e.to_email, e.sent_by, p.display_name,
         e.created_at, e.sent_at, e.last_event_at, e.error_code
    from public.email_log e
    join public.email_template_defaults d on d.key = e.template_key
    left join public.profiles p on p.user_id = e.sent_by and p.org_id = e.org_id
   where e.org_id = (select private.current_user_org_id())
     and (e.view_permission = any ((select private.current_permission_keys())::text[])
          or (select private.has_permission('settings.email_manage')))
     and e.subject_type = p_subject_type
     and e.subject_id = p_subject_id
   order by e.created_at desc, e.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke all on function
  public.set_email_sender(text, text, text),
  public.set_email_sending_domain(text),
  public.list_email_templates(),
  public.save_email_template(text, text, text, text),
  public.reset_email_template(text),
  public.list_email_log(text, text, timestamptz, timestamptz, timestamptz, int, uuid),
  public.list_subject_emails(text, uuid, int)
from public, anon, authenticated, service_role;
grant execute on function
  public.set_email_sender(text, text, text),
  public.set_email_sending_domain(text),
  public.list_email_templates(),
  public.save_email_template(text, text, text, text),
  public.reset_email_template(text),
  public.list_email_log(text, text, timestamptz, timestamptz, timestamptz, int, uuid),
  public.list_subject_emails(text, uuid, int)
to authenticated;
-- service_role is revoked above: these act for the calling user's org (auth.uid()).

-- -----------------------------------------------------------------------------
-- Service-role RPCs (supabase/functions/_shared/email/send.ts, resend-webhook)
-- -----------------------------------------------------------------------------
-- Everything one send needs, in one round trip (shape: send.ts `contextSchema`). Unknown
-- org or key → 22023. With no reply-to set, the org email is the reply-to when it is one
-- mailbox (as the seed does).
create function public.get_email_context(p_org_id uuid, p_template_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
begin
  select pg_catalog.jsonb_build_object(
           'module_key', d.module_key,
           'module_enabled', public.module_enabled_for_org(o.id, d.module_key),
           'timezone', o.timezone,
           'template', pg_catalog.jsonb_build_object(
             'key', d.key,
             'version', coalesce(t.version, 0),
             'subject', coalesce(t.subject, d.subject),
             'body', coalesce(t.body, d.body),
             'button_label', case when t.org_id is null then d.button_label else t.button_label end,
             'why_line', d.why_line,
             'variables', d.variables,
             'view_permission', d.view_permission,
             'recipient_mode', d.recipient_mode,
             'allows_attachments', d.allows_attachments),
           'sender', pg_catalog.jsonb_build_object(
             'from_name', s.from_name,
             'from_address', s.from_address,
             'reply_to', coalesce(s.reply_to, case when private.is_mailbox(o.email) then o.email end)),
           'clinic', pg_catalog.jsonb_build_object(
             'name', o.name,
             'address_line1', o.address_line1,
             'address_line2', o.address_line2,
             'city', o.city,
             'province', o.province,
             'postal_code', o.postal_code,
             'phone', o.phone,
             'website', o.website,
             'privacy_officer_name', o.privacy_officer_name,
             'privacy_officer_email', o.privacy_officer_email))
    into v_context
    from public.email_template_defaults d
   cross join public.organizations o
    join public.email_settings s on s.org_id = o.id
    left join public.email_templates t on t.org_id = o.id and t.key = d.key
   where d.key = p_template_key and o.id = p_org_id;
  if v_context is null then
    raise exception 'Organisation ou modèle de courriel inconnu' using errcode = '22023';
  end if;
  return v_context;
end;
$$;

-- Logs one message as `queued` before it is handed to the provider; its id is the
-- idempotency key and the `email_log_id` tag. The module comes from the template. Refused
-- (22023): an unknown template, no recipient address, a view permission other than the
-- catalogue's, a version other than the org's current one (0 for the default, else the
-- override's), a recipient profile or sender outside the org.
create function public.queue_email(
  p_org_id uuid,
  p_template_key text,
  p_template_version int,
  p_to_email text,
  p_to_profile_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_view_permission text,
  p_sent_by uuid,
  p_attachment_count smallint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_default public.email_template_defaults%rowtype;
  v_version int;
  v_id uuid;
begin
  select * into v_default from public.email_template_defaults d where d.key = p_template_key;
  if not found then
    raise exception 'Modèle de courriel inconnu' using errcode = '22023';
  end if;
  if p_to_email is null then
    raise exception 'Adresse du destinataire manquante' using errcode = '22023';
  end if;
  if p_view_permission is distinct from v_default.view_permission then
    raise exception 'Permission de consultation différente de celle du modèle' using errcode = '22023';
  end if;
  select coalesce((select t.version from public.email_templates t
                    where t.org_id = p_org_id and t.key = p_template_key), 0)
    into v_version;
  if p_template_version is distinct from v_version then
    raise exception 'Version du modèle différente de la version en vigueur' using errcode = '22023';
  end if;
  if (p_to_profile_id is not null
      and not exists (select 1 from public.profiles p where p.user_id = p_to_profile_id and p.org_id = p_org_id))
     or (p_sent_by is not null
         and not exists (select 1 from public.profiles p where p.user_id = p_sent_by and p.org_id = p_org_id)) then
    raise exception 'Destinataire ou expéditeur hors de l''organisation' using errcode = '22023';
  end if;

  insert into public.email_log
    (org_id, module_key, template_key, template_version, to_email, to_profile_id,
     subject_type, subject_id, view_permission, sent_by, attachment_count)
  values
    (p_org_id, v_default.module_key, p_template_key, p_template_version, p_to_email, p_to_profile_id,
     p_subject_type, p_subject_id, p_view_permission, p_sent_by, p_attachment_count)
  returning id into v_id;
  return v_id;
end;
$$;

-- The provider accepted the message. A queued row (or one whose outcome was unknown) becomes
-- `sent`; a row a webhook already moved on keeps its status. The provider id is kept once set.
create function public.mark_email_sent(p_id uuid, p_resend_id text, p_attempts int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_resend_id is null or pg_catalog.length(p_resend_id) not between 1 and 200
     or p_attempts is null or p_attempts not between 0 and 100 then
    raise exception 'Résultat d''envoi invalide' using errcode = '22023';
  end if;
  update public.email_log e
     set status = case when e.status = 'queued' or (e.status = 'failed' and e.error_code = 'provider_unavailable')
                       then 'sent' else e.status end,
         error_code = case when e.status = 'failed' and e.error_code = 'provider_unavailable'
                           then null else e.error_code end,
         resend_id = coalesce(e.resend_id, p_resend_id),
         attempts = greatest(e.attempts, p_attempts),
         sent_at = coalesce(e.sent_at, pg_catalog.now())
   where e.id = p_id;
  if not found then
    raise exception 'Courriel inconnu' using errcode = '22023';
  end if;
end;
$$;

-- The send failed (a transport code). Only a queued row, or one whose outcome was unknown,
-- becomes `failed`: a webhook outcome is never overridden.
create function public.mark_email_failed(p_id uuid, p_error_code text, p_attempts int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$'
     or p_attempts is null or p_attempts not between 0 and 100 then
    raise exception 'Résultat d''envoi invalide' using errcode = '22023';
  end if;
  update public.email_log e
     set status = case when e.status = 'queued' or (e.status = 'failed' and e.error_code = 'provider_unavailable')
                       then 'failed' else e.status end,
         error_code = case when e.status = 'queued' or (e.status = 'failed' and e.error_code = 'provider_unavailable')
                           then p_error_code else e.error_code end,
         attempts = greatest(e.attempts, p_attempts)
   where e.id = p_id;
  if not found then
    raise exception 'Courriel inconnu' using errcode = '22023';
  end if;
end;
$$;

-- Applies a delivery webhook event (resend-webhook, Task 3.10) to its row, found by id (the
-- `email_log_id` tag), else by provider id. `p_status` is a webhook status, or `failed` for
-- the provider's failure event (stored as `provider_failed`). Returns `applied`, `ignored`
-- (the tag and the provider id name two different rows, the module is disabled for the org,
-- the row is final, or the event would move it backwards) or `not_found` (no row, or a row
-- of another org). Order and final states: see the header.
create function public.apply_email_event(
  p_org_id uuid,
  p_email_log_id uuid,
  p_resend_id text,
  p_status text,
  p_at timestamptz
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.email_log%rowtype;
  v_current int;
  v_next int;
  v_at timestamptz := coalesce(p_at, pg_catalog.now());
begin
  if p_org_id is null or p_status is null
     or p_status not in ('sent', 'delivery_delayed', 'delivered', 'bounced', 'complained', 'failed') then
    raise exception 'Événement de courriel invalide' using errcode = '22023';
  end if;

  if p_email_log_id is not null then
    select * into v_row from public.email_log e where e.id = p_email_log_id for update;
  end if;
  if v_row.id is null and p_resend_id is not null then
    select * into v_row from public.email_log e where e.resend_id = p_resend_id for update;
  end if;
  if v_row.id is null or v_row.org_id <> p_org_id then
    return 'not_found';
  end if;
  -- The provider id belongs to another row: storing it would raise 23505 at every retry.
  if p_resend_id is not null
     and exists (select 1 from public.email_log x where x.resend_id = p_resend_id and x.id <> v_row.id) then
    return 'ignored';
  end if;
  if not public.module_enabled_for_org(v_row.org_id, v_row.module_key) then
    return 'ignored';
  end if;

  -- Ranks: queued and an unknown outcome 0, sent 1, delivery_delayed 2, delivered 3;
  -- bounced, complained and failed 4 (final); any other failure is final. A failure event
  -- never overrides a delivery.
  if v_row.status in ('bounced', 'complained')
     or (v_row.status = 'failed' and v_row.error_code <> 'provider_unavailable')
     or (p_status = 'failed' and v_row.status = 'delivered') then
    return 'ignored';
  end if;
  v_current := case v_row.status when 'sent' then 1 when 'delivery_delayed' then 2 when 'delivered' then 3 else 0 end;
  v_next := case p_status when 'sent' then 1 when 'delivery_delayed' then 2 when 'delivered' then 3 else 4 end;
  if v_next <= v_current then
    return 'ignored';
  end if;

  update public.email_log e
     set status = p_status,
         error_code = case when p_status = 'failed' then 'provider_failed' end,
         resend_id = coalesce(e.resend_id, p_resend_id),
         -- A message the provider failed was never sent: sent_at stays as it was.
         sent_at = case when p_status = 'failed' then e.sent_at else coalesce(e.sent_at, v_at) end,
         last_event_at = v_at
   where e.id = v_row.id;
  return 'applied';
end;
$$;

-- Messages logged today (clinic day, organizations.timezone) for an org; 0 for an unknown
-- org. The day's bounds are computed first, so the count is an index range of
-- `email_log_org_created_idx`. Both bounds matter: a generic plan rates `created_at >= $1`
-- alone as a third of the table and may scan all of it (seen at 24 000 rows), a closed range
-- as a small slice.
-- Measured, generic plan, 12 000 rows in each of two orgs, ~100 today: an index-only range
-- reading only today's entries.
create function public.count_org_emails_today(p_org_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_count int;
begin
  select o.timezone into v_timezone from public.organizations o where o.id = p_org_id;
  if not found then
    return 0;
  end if;
  -- Local midnight to the next local midnight (23 or 25 hours on a DST change).
  v_day_start := pg_catalog.date_trunc('day', pg_catalog.now() at time zone v_timezone) at time zone v_timezone;
  v_day_end := (pg_catalog.date_trunc('day', pg_catalog.now() at time zone v_timezone) + interval '1 day')
               at time zone v_timezone;
  select pg_catalog.count(*)::int into v_count
    from public.email_log e
   where e.org_id = p_org_id
     and e.created_at >= v_day_start
     and e.created_at < v_day_end;
  return v_count;
end;
$$;

revoke all on function
  public.get_email_context(uuid, text),
  public.queue_email(uuid, text, int, text, uuid, text, uuid, text, uuid, smallint),
  public.mark_email_sent(uuid, text, int),
  public.mark_email_failed(uuid, text, int),
  public.apply_email_event(uuid, uuid, text, text, timestamptz),
  public.count_org_emails_today(uuid)
from public, anon, authenticated;
grant execute on function
  public.get_email_context(uuid, text),
  public.queue_email(uuid, text, int, text, uuid, text, uuid, text, uuid, smallint),
  public.mark_email_sent(uuid, text, int),
  public.mark_email_failed(uuid, text, int),
  public.apply_email_event(uuid, uuid, text, text, timestamptz),
  public.count_org_emails_today(uuid)
to service_role;

-- -----------------------------------------------------------------------------
-- Maintenance jobs (private.run_sql_job, Task 3.3)
-- -----------------------------------------------------------------------------
-- Anonymises recipients after 24 months (P3-6): the row stays, `to_email` becomes null.
-- Batches of 5 000 keep each statement bounded. The run is one transaction, so its row locks
-- last until it ends; they are on rows over 24 months old, which nothing else writes.
create function private.job_email_log_retention()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_batch bigint;
  v_total bigint := 0;
begin
  loop
    update public.email_log e set to_email = null
     where e.id in (select x.id from public.email_log x
                     where x.to_email is not null
                       and x.created_at < pg_catalog.now() - interval '24 months'
                     limit 5000);
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch < 5000;
  end loop;
  return 'anonymised=' || v_total;
end;
$$;

-- Rows still queued after 15 minutes (the function was killed between queue and mark: the
-- edge wall clock is 150 s) fail as `provider_unavailable`, an outcome a webhook may still
-- correct (header).
create function private.job_email_log_stale_queued()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_failed bigint;
begin
  update public.email_log e
     set status = 'failed', error_code = 'provider_unavailable'
   where e.status = 'queued' and e.created_at < pg_catalog.now() - interval '15 minutes';
  get diagnostics v_failed = row_count;
  return 'failed=' || v_failed;
end;
$$;

revoke all on function
  private.job_email_log_retention(),
  private.job_email_log_stale_queued()
from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('core.email_log_retention', 'core', 'Anonymisation de l''historique des courriels',
   'Retire l''adresse des destinataires des courriels envoyés il y a plus de 24 mois. L''envoi reste inscrit.',
   'sql', 'private.job_email_log_retention', 'core.email_log_retention', true),
  ('core.email_log_stale_queued', 'core', 'Suivi des courriels en attente',
   'Marque en échec, issue inconnue, les courriels restés en attente d''envoi plus de 15 minutes.',
   'sql', 'private.job_email_log_stale_queued', 'core.email_log_stale_queued', true)
on conflict do nothing;

select cron.schedule('core.email_log_retention', '30 8 * * *',
  $$select private.run_sql_job('core.email_log_retention')$$);
select cron.schedule('core.email_log_stale_queued', '*/5 * * * *',
  $$select private.run_sql_job('core.email_log_stale_queued')$$);

-- -----------------------------------------------------------------------------
-- Core template: staff invitation (Task 3.18 / 3.20)
-- -----------------------------------------------------------------------------
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
values (
  'core.staff_invite', 'core',
  'Invitation d''un membre du personnel',
  'Envoyé quand un administrateur invite une personne à rejoindre l''équipe de la clinique.',
  'Vous recevez ce courriel parce que la clinique vous invite à créer votre accès.',
  'Votre accès à {{clinic.name}}',
  E'Bonjour {{invitee.display_name}},\n\n'
  '{{inviter.display_name}} vous invite à rejoindre l''équipe de {{clinic.name}} et à créer votre accès. '
  'Ce lien est personnel et reste valide jusqu''au {{invitation.expires_at}}.\n\n'
  'Si vous n''attendiez pas cette invitation, vous pouvez ignorer ce courriel.',
  'Créer mon accès',
  '[
    {"path": "invitee.display_name", "label": "Nom de la personne invitée", "sample": "Marie Tremblay", "required": true, "kind": "text"},
    {"path": "inviter.display_name", "label": "Nom de la personne qui invite", "sample": "Julie Roy", "required": true, "kind": "text"},
    {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
    {"path": "invitation.expires_at", "label": "Fin de validité de l''invitation", "sample": "15 octobre 2026 à 14 h 30", "required": true, "kind": "datetime"}
  ]',
  'users.view'
)
on conflict do nothing;
