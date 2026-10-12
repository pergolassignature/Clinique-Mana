-- =============================================================================
-- Module Communications (« Communications »), batch CM1: the Gmail connection and the mirror
-- =============================================================================
-- The module and its permissions are registered by *_communications_module.sql. This migration
-- adds the tables of the Gmail mirror: the clinic's
-- mailboxes (`info@`, `administration@`: one row each), their OAuth tokens (encrypted, never read by
-- a client), the sync state (history id, lease, watch), the labels, threads, messages, attachments
-- and the thread → client link. The edge functions `gmail-connect`, `gmail-callback`,
-- `gmail-webhook`, `gmail-sync` and `gmail-watch-renew` write through the service-role RPCs below.
--
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §11 (CM1), §13 (OAuth helpers)
-- Roadmap:   docs/plans/2026-10-11-next-modules-roadmap.md §2.4, §2.4 bis (PS Hub's flaws), §3.3
-- Recipe:    docs/standards/database-conventions.md (§8 encrypted columns, §8b service RPCs with an actor)
-- Decisions: CM-1 … CM-8 (docs/plans/2026-10-07-decisions-log.md)
--
-- Key choices:
-- * Tokens (roadmap §2.4 bis): `mail_connection_tokens` holds the access and refresh tokens
--   encrypted with `private.encrypt_pii` under a key version (ADR 0004, conventions §8), on a table
--   with no client privilege and nothing for `service_role` either; `get_mail_connection_credentials`
--   (service role only, called by the functions) is the one reader. Never returned to a browser,
--   never in the audit log (both columns redacted).
-- * The mirror is not audited (CM-2): `mail_threads`, `mail_messages`, `mail_attachments`,
--   `mail_labels` and `mail_sync_state` are written by the sync (service role) from what Gmail
--   holds, hold client correspondence (Loi 25) and are purged; auditing them would copy every
--   subject, address and snippet into the append-only `audit_log` forever. They join the exception
--   list of `000_invariants` (§12). What a person does is audited: `mail_connections` (connect,
--   disconnect, status), `mail_connection_tokens` (redacted) and `mail_thread_links`.
-- * Personal mailboxes (`kind = 'personal'`, roadmap §2.4) are in the model from the start: a row
--   is visible to its owner only (`private.visible_mail_connection_ids`), the shared ones to every
--   holder of `communications.inbox`. CM1's screens connect shared mailboxes only.
-- * The sync lease (`mail_sync_state.lease_token` / `lease_until`) keeps two syncs of one mailbox
--   apart; a lease older than its deadline is taken over (a sync that died). `sync_requested_at`
--   is set by the webhook: a sync that could not take the lease is not lost, the holder (or the
--   15-minute job) runs again while it is newer than `last_sync_at`.
-- * History ids are Gmail's (uint64 in practice far below bigint's range).
-- * Bodies are kept 24 months (roadmap question 30, Christine to confirm): the maintenance job
--   `communications.mail_bodies_purge` nulls `body_html`, `body_text` and `snippet` of older
--   messages and soft-deletes their attachments' files (the storage cleanup removes the objects);
--   the headers stay, like `email_log` after its anonymisation (CM-8).
-- * Attachments are copied into our storage as system files of the purpose `mail_attachment`
--   (bucket `documents`, read with `communications.inbox` through `storage-sign`), only for the
--   types the storage map accepts (PDF, images, Word); the others are listed with
--   `status = 'unsupported_type'` and stay readable in Gmail (CM-5). Inline images (a `cid:`) are
--   attachments like the others, with their `content_id`: the viewer resolves them through signed
--   URLs, never a public bucket (PS Hub's flaw).
-- * `upsert_mail_messages` recomputes each touched thread's summary (counts, unread, labels, the
--   last message's sender) in the same statement: the browser never derives them.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:communications_gmail', true);

-- -----------------------------------------------------------------------------
-- Module settings: the Pub/Sub topic (the only setting of CM1)
-- -----------------------------------------------------------------------------
-- The effective settings of an org: the stored object over the defaults.
create function private.communications_settings(p_org uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('pubsub_topic', null) || coalesce(
    (select s.settings from public.org_module_settings s where s.org_id = p_org and s.module_key = 'communications'),
    '{}'::jsonb)
$$;
revoke all on function private.communications_settings(uuid) from public, anon, authenticated, service_role;

create function public.get_communications_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('communications.mailboxes_manage') then
    raise exception 'Permission refusée : communications.mailboxes_manage' using errcode = '42501';
  end if;
  return private.communications_settings(private.current_user_org_id());
end;
$$;
revoke all on function public.get_communications_settings() from public, anon, authenticated;
grant execute on function public.get_communications_settings() to authenticated;

-- Merges a patch of known keys; returns the effective settings. `pubsub_topic` is Google's full
-- topic name (`projects/<project>/topics/<topic>`) or null (the watch is then not started).
create function public.set_communications_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_topic text;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if not private.has_permission('communications.mailboxes_manage') then
    raise exception 'Permission refusée : communications.mailboxes_manage' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'A settings patch must be an object' using errcode = '22023';
  end if;
  if p_patch - 'pubsub_topic' <> '{}'::jsonb then
    raise exception 'Unknown communications setting' using errcode = '22023';
  end if;
  if p_patch ? 'pubsub_topic' then
    if jsonb_typeof(p_patch->'pubsub_topic') not in ('string', 'null') then
      raise exception 'pubsub_topic must be a string or null' using errcode = '22023';
    end if;
    v_topic := nullif(pg_catalog.btrim(p_patch->>'pubsub_topic'), '');
    if v_topic is not null and v_topic !~ '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/topics/[A-Za-z][A-Za-z0-9._~%+-]{2,254}$' then
      raise exception 'Le nom du sujet Pub/Sub doit avoir la forme projects/<projet>/topics/<sujet>.' using errcode = 'P0001';
    end if;
    p_patch := jsonb_build_object('pubsub_topic', to_jsonb(v_topic));
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:set_communications_settings', true);
  insert into public.org_module_settings as s (org_id, module_key, settings)
  values (v_org, 'communications', p_patch)
  on conflict (org_id, module_key) do update set settings = s.settings || excluded.settings;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return private.communications_settings(v_org);
end;
$$;
revoke all on function public.set_communications_settings(jsonb) from public, anon, authenticated;
grant execute on function public.set_communications_settings(jsonb) to authenticated;

-- The same object for the functions (the sync reads the topic): service role only.
create function public.get_communications_settings_for_org(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.communications_settings(p_org_id)
$$;
revoke all on function public.get_communications_settings_for_org(uuid) from public, anon, authenticated;
grant execute on function public.get_communications_settings_for_org(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- mail_connections: one row per mailbox (audited)
-- -----------------------------------------------------------------------------
create table public.mail_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- The Gmail address, lower case (Google's `emailAddress`).
  email_address text not null,
  -- `shared`: the clinic's (read by every holder of communications.inbox); `personal`: its
  -- owner's only (roadmap §2.4).
  kind text not null default 'shared',
  owner_profile_id uuid,
  -- `connected`; `needs_reconnect` (Google refused the refresh: `invalid_grant`, a scope missing);
  -- `disconnected` (« Déconnecter »: tokens deleted, the mirror kept).
  status text not null default 'connected',
  -- Why `needs_reconnect`: a code (`invalid_grant`, `scope_missing`, `unauthorized`), never a text.
  status_reason text,
  -- The scopes Google granted (`gmail.modify`, `gmail.send`).
  scopes text[] not null default '{}',
  connected_by uuid references public.profiles(user_id) on delete set null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  disconnected_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_connections_email_check check (
    email_address = pg_catalog.lower(email_address) and pg_catalog.length(email_address) <= 254
    and email_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint mail_connections_kind_check check (kind in ('shared', 'personal')),
  constraint mail_connections_status_check check (status in ('connected', 'needs_reconnect', 'disconnected')),
  constraint mail_connections_status_reason_check check (status_reason is null or status_reason ~ '^[a-z0-9_]{1,64}$'),
  constraint mail_connections_owner_check check (kind = 'shared' or owner_profile_id is not null),
  constraint mail_connections_scopes_check check (pg_catalog.cardinality(scopes) <= 20),
  -- One row per address per clinic: reconnecting the same mailbox reuses the row (its mirror too).
  constraint mail_connections_org_email_key unique (org_id, email_address),
  constraint mail_connections_org_id_id_key unique (org_id, id),
  -- A personal mailbox's owner is a member of the same clinic (composite FK, conventions §4).
  constraint mail_connections_owner_fkey foreign key (owner_profile_id, org_id)
    references public.profiles(user_id, org_id) on delete cascade
);
create index mail_connections_owner_idx on public.mail_connections (owner_profile_id);
create index mail_connections_connected_by_idx on public.mail_connections (connected_by);
create index mail_connections_disconnected_by_idx on public.mail_connections (disconnected_by);

revoke all on public.mail_connections from anon, authenticated;
grant select on public.mail_connections to authenticated;
alter table public.mail_connections enable row level security;

-- The mailboxes the caller may read: the clinic's shared ones with communications.inbox or
-- communications.mailboxes_manage, plus her own personal ones. One array per statement (the
-- policies of every mirror table test `connection_id = any (…)`).
create function private.visible_mail_connection_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}'::uuid[])
    from public.mail_connections c
   where c.org_id = private.current_user_org_id()
     and (private.has_permission('communications.inbox') or private.has_permission('communications.mailboxes_manage'))
     and (c.kind = 'shared' or (c.owner_profile_id = auth.uid() and private.has_permission('communications.inbox')))
$$;
revoke all on function private.visible_mail_connection_ids() from public, anon;
grant execute on function private.visible_mail_connection_ids() to authenticated, service_role;

create policy mail_connections_select on public.mail_connections
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and id = any ((select private.visible_mail_connection_ids())::uuid[])
  );

create trigger mail_connections_set_updated_at before update on public.mail_connections
  for each row execute function private.set_updated_at();
create trigger mail_connections_audit after insert or update or delete on public.mail_connections
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- mail_connection_tokens: the OAuth tokens, encrypted (conventions §8; nobody reads the table)
-- -----------------------------------------------------------------------------
create table public.mail_connection_tokens (
  connection_id uuid primary key references public.mail_connections(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  access_token bytea not null,
  refresh_token bytea not null,
  access_token_expires_at timestamptz not null,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_connection_tokens_key_version_check check (key_version >= 1),
  constraint mail_connection_tokens_connection_fkey foreign key (org_id, connection_id)
    references public.mail_connections(org_id, id) on delete cascade
);
create index mail_connection_tokens_org_idx on public.mail_connection_tokens (org_id);

revoke all on public.mail_connection_tokens from anon, authenticated, service_role;
alter table public.mail_connection_tokens enable row level security;
-- No policy on purpose: the service RPCs below are the only path.

create trigger mail_connection_tokens_set_updated_at before update on public.mail_connection_tokens
  for each row execute function private.set_updated_at();
create trigger mail_connection_tokens_audit after insert or update or delete on public.mail_connection_tokens
  for each row execute function private.audit_trigger('access_token', 'refresh_token');

-- The list of encrypted columns (conventions §8): the two token columns added. Same signature,
-- grants (none) and contract as *_core_pii_key_versions.sql.
create or replace function private.pii_encrypted_values()
returns table (table_name text, column_name text, row_key text, key_version integer, ciphertext bytea)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'organization_bank_details'::text, 'account_number'::text, b.org_id::text, b.key_version::integer, b.account_number
    from public.organization_bank_details b
   where b.account_number is not null
  union all
  select 'professional_private'::text, 'sin'::text, p.professional_id::text, p.key_version::integer, p.sin
    from public.professional_private p
   where p.sin is not null
  union all
  select 'professional_private'::text, 'bank_account'::text, p.professional_id::text, p.key_version::integer, p.bank_account
    from public.professional_private p
   where p.bank_account is not null
  union all
  select 'professional_submission_private'::text, 'sin'::text, s.submission_id::text, s.key_version::integer, s.sin
    from public.professional_submission_private s
   where s.sin is not null
  union all
  select 'professional_submission_private'::text, 'bank_account'::text, s.submission_id::text, s.key_version::integer, s.bank_account
    from public.professional_submission_private s
   where s.bank_account is not null
  union all
  select 'mail_connection_tokens'::text, 'access_token'::text, t.connection_id::text, t.key_version::integer, t.access_token
    from public.mail_connection_tokens t
  union all
  select 'mail_connection_tokens'::text, 'refresh_token'::text, t.connection_id::text, t.key_version::integer, t.refresh_token
    from public.mail_connection_tokens t
$$;

-- -----------------------------------------------------------------------------
-- mail_sync_state: history id, lease, watch (operational, not audited)
-- -----------------------------------------------------------------------------
create table public.mail_sync_state (
  connection_id uuid primary key references public.mail_connections(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- The last Gmail history id applied; null until the first sync, or after a 404 / 410 (a new
  -- full pass then reads the profile's).
  history_id bigint,
  -- The sync lease: the holder's token and its deadline.
  lease_token uuid,
  lease_until timestamptz,
  -- Set by the webhook (and « Synchroniser »); a sync is due while it is newer than last_sync_at.
  sync_requested_at timestamptz,
  last_sync_started_at timestamptz,
  -- The last sync that ended without error.
  last_sync_at timestamptz,
  last_sync_status text,
  -- A code (`invalid_grant`, `history_unavailable`, `provider_error`…), never a text.
  last_error_code text,
  last_error_at timestamptz,
  -- The 45-day first pass: done once every page was read; the page token resumes an interrupted one.
  initial_sync_done boolean not null default false,
  initial_sync_page_token text,
  -- The Pub/Sub watch (`users.watch`): Google's expiry (7 days) and the history id it returned.
  watch_expires_at timestamptz,
  watch_history_id bigint,
  messages_synced bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint mail_sync_state_status_check check (last_sync_status is null or last_sync_status in ('ok', 'error')),
  constraint mail_sync_state_error_check check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  constraint mail_sync_state_connection_fkey foreign key (org_id, connection_id)
    references public.mail_connections(org_id, id) on delete cascade
);
create index mail_sync_state_org_idx on public.mail_sync_state (org_id);

revoke all on public.mail_sync_state from anon, authenticated;
alter table public.mail_sync_state enable row level security;
-- No client policy: the state reaches the screens through list_mail_connections.

create trigger mail_sync_state_set_updated_at before update on public.mail_sync_state
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- mail_labels: the mailbox's labels (system and user), for the inbox's left pane
-- -----------------------------------------------------------------------------
create table public.mail_labels (
  connection_id uuid not null references public.mail_connections(id) on delete cascade,
  -- Gmail's id (`INBOX`, `Label_12`).
  gmail_label_id text not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null,
  -- Gmail's `labelListVisibility`: `labelShow`, `labelShowIfUnread`, `labelHide`.
  visibility text,
  color_background text,
  color_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (connection_id, gmail_label_id),
  constraint mail_labels_id_check check (gmail_label_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  constraint mail_labels_name_check check (pg_catalog.length(name) between 1 and 225),
  constraint mail_labels_type_check check (type in ('system', 'user')),
  constraint mail_labels_color_check check (
    (color_background is null or color_background ~ '^#[0-9a-fA-F]{6}$')
    and (color_text is null or color_text ~ '^#[0-9a-fA-F]{6}$')),
  constraint mail_labels_connection_fkey foreign key (org_id, connection_id)
    references public.mail_connections(org_id, id) on delete cascade
);
create index mail_labels_org_idx on public.mail_labels (org_id);

revoke all on public.mail_labels from anon, authenticated;
grant select on public.mail_labels to authenticated;
alter table public.mail_labels enable row level security;
create policy mail_labels_select on public.mail_labels
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and connection_id = any ((select private.visible_mail_connection_ids())::uuid[])
  );
create trigger mail_labels_set_updated_at before update on public.mail_labels
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- mail_threads: one row per Gmail thread, its summary kept by the database
-- -----------------------------------------------------------------------------
create table public.mail_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.mail_connections(id) on delete cascade,
  gmail_thread_id text not null,
  -- The first message's subject (the thread's), the last message's snippet and sender.
  subject text,
  snippet text,
  last_from_name text,
  last_from_address text,
  first_message_at timestamptz,
  last_message_at timestamptz,
  message_count int not null default 0,
  -- Unread messages outside the trash and spam.
  unread_count int not null default 0,
  has_attachments boolean not null default false,
  -- The union of the messages' labels: the list's views (INBOX, SENT, STARRED, a user label).
  label_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_threads_gmail_id_check check (gmail_thread_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint mail_threads_connection_thread_key unique (connection_id, gmail_thread_id),
  constraint mail_threads_org_id_id_key unique (org_id, id),
  constraint mail_threads_connection_fkey foreign key (org_id, connection_id)
    references public.mail_connections(org_id, id) on delete cascade
);
-- The list, newest first, per mailbox; the labels' containment for the views.
create index mail_threads_connection_last_idx on public.mail_threads (connection_id, last_message_at desc, id desc);
create index mail_threads_org_idx on public.mail_threads (org_id);
create index mail_threads_labels_idx on public.mail_threads using gin (label_ids);

revoke all on public.mail_threads from anon, authenticated;
grant select on public.mail_threads to authenticated;
alter table public.mail_threads enable row level security;
create policy mail_threads_select on public.mail_threads
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and connection_id = any ((select private.visible_mail_connection_ids())::uuid[])
  );
create trigger mail_threads_set_updated_at before update on public.mail_threads
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- mail_messages: the mirror of each message (headers, snippet, body for 24 months)
-- -----------------------------------------------------------------------------
create table public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.mail_connections(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  gmail_message_id text not null,
  -- The RFC 5322 headers that thread messages across mailboxes.
  rfc_message_id text,
  in_reply_to text,
  from_name text,
  from_address text,
  -- `[{ "name": …, "address": … }]`, addresses lower case.
  to_addresses jsonb not null default '[]',
  cc_addresses jsonb not null default '[]',
  bcc_addresses jsonb not null default '[]',
  reply_to_address text,
  subject text,
  snippet text,
  -- Gmail's internalDate.
  sent_at timestamptz not null,
  label_ids text[] not null default '{}',
  is_unread boolean not null default false,
  -- Not sent by the mailbox itself (the SENT label is Gmail's word on it).
  is_inbound boolean not null default true,
  has_attachments boolean not null default false,
  body_html text,
  body_text text,
  -- The bodies and snippet nulled by the 24-month purge (communications.mail_bodies_purge).
  body_purged_at timestamptz,
  size_estimate int,
  -- What the search reads: subject, sender and snippet (never the body: it is purged, and its
  -- HTML would drown the index).
  search_vector tsvector generated always as (
    to_tsvector('french', coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' || coalesce(from_address, '')
                          || ' ' || coalesce(snippet, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_messages_gmail_id_check check (gmail_message_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint mail_messages_addresses_check check (
    jsonb_typeof(to_addresses) = 'array' and jsonb_typeof(cc_addresses) = 'array' and jsonb_typeof(bcc_addresses) = 'array'),
  constraint mail_messages_body_check check (
    (body_html is null or pg_catalog.length(body_html) <= 1048576) and (body_text is null or pg_catalog.length(body_text) <= 1048576)),
  constraint mail_messages_text_check check (
    (subject is null or pg_catalog.length(subject) <= 2000) and (snippet is null or pg_catalog.length(snippet) <= 1000)
    and (from_name is null or pg_catalog.length(from_name) <= 500) and (from_address is null or pg_catalog.length(from_address) <= 320)),
  constraint mail_messages_connection_message_key unique (connection_id, gmail_message_id),
  constraint mail_messages_org_id_id_key unique (org_id, id),
  constraint mail_messages_thread_fkey foreign key (org_id, thread_id)
    references public.mail_threads(org_id, id) on delete cascade,
  constraint mail_messages_connection_fkey foreign key (org_id, connection_id)
    references public.mail_connections(org_id, id) on delete cascade
);
create index mail_messages_thread_sent_idx on public.mail_messages (thread_id, sent_at, id);
create index mail_messages_org_idx on public.mail_messages (org_id);
-- The purge reads the oldest unpurged messages of an org.
create index mail_messages_purge_idx on public.mail_messages (org_id, sent_at) where body_purged_at is null;
create index mail_messages_search_idx on public.mail_messages using gin (search_vector);
create index mail_messages_from_idx on public.mail_messages (connection_id, from_address);

revoke all on public.mail_messages from anon, authenticated;
grant select on public.mail_messages to authenticated;
alter table public.mail_messages enable row level security;
create policy mail_messages_select on public.mail_messages
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and connection_id = any ((select private.visible_mail_connection_ids())::uuid[])
  );
create trigger mail_messages_set_updated_at before update on public.mail_messages
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- mail_attachments: the message's parts, copied into our storage when the type is accepted
-- -----------------------------------------------------------------------------
create table public.mail_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.mail_messages(id) on delete cascade,
  -- The MIME part (`1.2`), Gmail's attachment id (it changes between reads: never a key).
  part_id text not null,
  gmail_attachment_id text,
  filename text,
  mime_type text,
  size_bytes int,
  -- The `Content-ID` of an inline image (without its angle brackets); `is_inline` when the body
  -- references it as `cid:`.
  content_id text,
  is_inline boolean not null default false,
  -- `pending` (to copy), `stored`, `unsupported_type` (outside the storage map), `too_large`,
  -- `failed` (the copy failed for good), `purged` (the 24-month purge).
  status text not null default 'pending',
  stored_file_id uuid references public.stored_files(id) on delete set null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_attachments_part_check check (part_id ~ '^[0-9.]{1,32}$'),
  constraint mail_attachments_gmail_id_check check (gmail_attachment_id is null or pg_catalog.length(gmail_attachment_id) <= 512),
  constraint mail_attachments_filename_check check (filename is null or pg_catalog.length(filename) <= 255),
  constraint mail_attachments_mime_check check (mime_type is null or mime_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  constraint mail_attachments_size_check check (size_bytes is null or size_bytes >= 0),
  constraint mail_attachments_content_id_check check (content_id is null or pg_catalog.length(content_id) <= 998),
  constraint mail_attachments_status_check check (
    status in ('pending', 'stored', 'unsupported_type', 'too_large', 'failed', 'purged')),
  constraint mail_attachments_stored_check check (status <> 'stored' or stored_file_id is not null),
  constraint mail_attachments_message_part_key unique (message_id, part_id),
  constraint mail_attachments_message_fkey foreign key (org_id, message_id)
    references public.mail_messages(org_id, id) on delete cascade
);
create index mail_attachments_org_idx on public.mail_attachments (org_id);
create index mail_attachments_stored_file_idx on public.mail_attachments (stored_file_id);
-- The copies still to make, oldest first.
create index mail_attachments_pending_idx on public.mail_attachments (org_id, created_at) where status = 'pending';

revoke all on public.mail_attachments from anon, authenticated;
grant select on public.mail_attachments to authenticated;
alter table public.mail_attachments enable row level security;
create policy mail_attachments_select on public.mail_attachments
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and exists (select 1 from public.mail_messages m
                 where m.id = mail_attachments.message_id
                   and m.connection_id = any ((select private.visible_mail_connection_ids())::uuid[]))
  );
create trigger mail_attachments_set_updated_at before update on public.mail_attachments
  for each row execute function private.set_updated_at();

-- The attachments' storage purpose (conventions §8b): system files registered by the sync, read
-- with communications.inbox. Nobody uploads with it from the browser (its upload permission is the
-- managers' one, and nothing attaches such an upload). No retention: the file lives with its
-- message (soft-deleted by the 24-month purge or when the message disappears).
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('mail_attachment', 'communications', 'documents', 'communications.mailboxes_manage', 'communications.inbox', null,
   10485760,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
   null, null)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- mail_thread_links: the thread → client link (audited; Clients arrives later, no FK)
-- -----------------------------------------------------------------------------
create table public.mail_thread_links (
  thread_id uuid primary key references public.mail_threads(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- `unlinked` (nothing matched), `needs_review` (several clients matched: « À rattacher »),
  -- `linked`.
  status text not null default 'unlinked',
  -- A client of the Clients module (not built yet: no FK, the module's helper resolves it later).
  client_id uuid,
  candidate_client_ids uuid[] not null default '{}',
  -- `auto` (the sync's identity match) or `manual`.
  source text,
  linked_by uuid references public.profiles(user_id) on delete set null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_thread_links_status_check check (status in ('unlinked', 'needs_review', 'linked')),
  constraint mail_thread_links_client_check check ((status = 'linked') = (client_id is not null)),
  constraint mail_thread_links_source_check check (source is null or source in ('auto', 'manual')),
  constraint mail_thread_links_candidates_check check (pg_catalog.cardinality(candidate_client_ids) <= 20),
  constraint mail_thread_links_thread_fkey foreign key (org_id, thread_id)
    references public.mail_threads(org_id, id) on delete cascade
);
create index mail_thread_links_org_status_idx on public.mail_thread_links (org_id, status);
create index mail_thread_links_client_idx on public.mail_thread_links (client_id);
create index mail_thread_links_linked_by_idx on public.mail_thread_links (linked_by);

revoke all on public.mail_thread_links from anon, authenticated;
grant select on public.mail_thread_links to authenticated;
alter table public.mail_thread_links enable row level security;
create policy mail_thread_links_select on public.mail_thread_links
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and exists (select 1 from public.mail_threads t
                 where t.id = mail_thread_links.thread_id
                   and t.connection_id = any ((select private.visible_mail_connection_ids())::uuid[]))
  );
create trigger mail_thread_links_set_updated_at before update on public.mail_thread_links
  for each row execute function private.set_updated_at();
create trigger mail_thread_links_audit after insert or update or delete on public.mail_thread_links
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- User RPC: the mailboxes and their state (« Courriels Gmail », the inbox's left pane)
-- -----------------------------------------------------------------------------
create function public.list_mail_connections()
returns table (
  id uuid, email_address text, kind text, status text, status_reason text, scopes text[],
  connected_at timestamptz, connected_by_name text, disconnected_at timestamptz,
  last_sync_at timestamptz, last_sync_status text, last_error_code text, last_error_at timestamptz,
  sync_in_progress boolean, initial_sync_done boolean, watch_expires_at timestamptz,
  messages_synced bigint, thread_count bigint, unread_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.email_address, c.kind, c.status, c.status_reason, c.scopes,
         c.connected_at, p.display_name, c.disconnected_at,
         s.last_sync_at, s.last_sync_status, s.last_error_code, s.last_error_at,
         coalesce(s.lease_until > pg_catalog.now(), false), coalesce(s.initial_sync_done, false), s.watch_expires_at,
         coalesce(s.messages_synced, 0),
         (select count(*) from public.mail_threads t where t.connection_id = c.id),
         (select count(*) from public.mail_threads t where t.connection_id = c.id and t.unread_count > 0 and 'INBOX' = any (t.label_ids))
    from public.mail_connections c
    left join public.mail_sync_state s on s.connection_id = c.id
    left join public.profiles p on p.user_id = c.connected_by and p.org_id = c.org_id
   where c.org_id = private.current_user_org_id()
     and c.id = any (private.visible_mail_connection_ids())
   order by c.kind, c.email_address
$$;
revoke all on function public.list_mail_connections() from public, anon, authenticated;
grant execute on function public.list_mail_connections() to authenticated;

-- -----------------------------------------------------------------------------
-- Service RPCs: the connection's life (gmail-callback, gmail-connect)
-- -----------------------------------------------------------------------------
-- The actor's standing for a connection change: an active member of p_org holding
-- communications.mailboxes_manage (the function verified it; re-checked here, conventions §8b).
create function private.assert_mail_manager(p_actor uuid, p_org uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_actor is null or p_org is null
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org and p.status = 'active')
     or not ('communications.mailboxes_manage' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : communications.mailboxes_manage' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_mail_manager(uuid, uuid) from public, anon, authenticated, service_role;

-- Stores (or reconnects) a mailbox for p_actor's clinic: the connection row (status `connected`),
-- its tokens encrypted under the current key version, and a fresh sync state (the mirror of a
-- reconnected address is kept; its history id is reset so the next sync starts a full pass).
-- Returns the connection id. P0001 when the address is already connected as a personal mailbox
-- of someone else (a shared one may be reconnected by any manager).
create function public.store_mail_connection(
  p_actor uuid, p_org_id uuid, p_email_address text, p_kind text,
  p_access_token text, p_refresh_token text, p_access_token_expires_at timestamptz, p_scopes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email_address, E' \t\r\n'));
  v_id uuid;
  v_version integer;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  perform private.assert_mail_manager(p_actor, p_org_id);
  if p_kind not in ('shared', 'personal') then
    raise exception 'Unknown mailbox kind' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or pg_catalog.length(v_email) > 254 then
    raise exception 'Adresse courriel invalide.' using errcode = 'P0001';
  end if;
  if coalesce(p_access_token, '') = '' or coalesce(p_refresh_token, '') = '' or p_access_token_expires_at is null then
    raise exception 'Tokens are required' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'communications') then
    raise exception 'Le module Communications n''est pas activé.' using errcode = 'P0001';
  end if;

  perform 1 from public.organizations o where o.id = p_org_id for no key update;
  perform pg_catalog.set_config('app.audit_source', 'rpc:store_mail_connection', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);

  select c.id into v_id from public.mail_connections c
   where c.org_id = p_org_id and c.email_address = v_email for no key update;
  if v_id is null then
    insert into public.mail_connections (org_id, email_address, kind, owner_profile_id, status, scopes, connected_by)
    values (p_org_id, v_email, p_kind, case when p_kind = 'personal' then p_actor end, 'connected',
            coalesce(p_scopes, '{}'), p_actor)
    returning id into v_id;
  else
    if exists (select 1 from public.mail_connections c
                where c.id = v_id and c.kind = 'personal' and c.owner_profile_id <> p_actor and c.status <> 'disconnected') then
      raise exception 'Cette boîte est déjà connectée comme boîte personnelle d''une autre personne.' using errcode = 'P0001';
    end if;
    update public.mail_connections c
       set kind = p_kind,
           owner_profile_id = case when p_kind = 'personal' then p_actor end,
           status = 'connected', status_reason = null,
           scopes = coalesce(p_scopes, '{}'),
           connected_by = p_actor, connected_at = pg_catalog.now(),
           disconnected_at = null, disconnected_by = null
     where c.id = v_id;
  end if;

  v_version := private.pii_current_key_version();
  insert into public.mail_connection_tokens as t (connection_id, org_id, access_token, refresh_token, access_token_expires_at, key_version)
  values (v_id, p_org_id, private.encrypt_pii(p_access_token, v_version), private.encrypt_pii(p_refresh_token, v_version),
          p_access_token_expires_at, v_version)
  on conflict (connection_id) do update
    set access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        access_token_expires_at = excluded.access_token_expires_at,
        key_version = excluded.key_version;

  insert into public.mail_sync_state as s (connection_id, org_id, sync_requested_at)
  values (v_id, p_org_id, pg_catalog.now())
  on conflict (connection_id) do update
    set history_id = null, initial_sync_done = false, initial_sync_page_token = null,
        lease_token = null, lease_until = null,
        last_error_code = null, last_error_at = null, last_sync_status = null,
        watch_expires_at = null, watch_history_id = null,
        sync_requested_at = pg_catalog.now();

  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_id;
end;
$$;
revoke all on function public.store_mail_connection(uuid, uuid, text, text, text, text, timestamptz, text[])
  from public, anon, authenticated;
grant execute on function public.store_mail_connection(uuid, uuid, text, text, text, text, timestamptz, text[]) to service_role;

-- « Déconnecter »: the connection becomes `disconnected`, its tokens and sync state are deleted
-- (the function revoked the grant at Google and stopped the watch first); the mirror stays.
-- Returns false when the row is not p_org's or is already disconnected.
create function public.disconnect_mail_connection(p_actor uuid, p_org_id uuid, p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
  v_found boolean;
begin
  perform private.assert_mail_manager(p_actor, p_org_id);
  perform pg_catalog.set_config('app.audit_source', 'rpc:disconnect_mail_connection', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  update public.mail_connections c
     set status = 'disconnected', status_reason = null,
         disconnected_at = pg_catalog.now(), disconnected_by = p_actor
   where c.id = p_connection_id and c.org_id = p_org_id and c.status <> 'disconnected';
  v_found := found;
  if v_found then
    delete from public.mail_connection_tokens t where t.connection_id = p_connection_id and t.org_id = p_org_id;
    delete from public.mail_sync_state s where s.connection_id = p_connection_id and s.org_id = p_org_id;
  end if;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_found;
end;
$$;
revoke all on function public.disconnect_mail_connection(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.disconnect_mail_connection(uuid, uuid, uuid) to service_role;

-- A connection of p_org with its tokens decrypted, for the functions (the one reader of the
-- tokens). No row for a disconnected mailbox or one without tokens.
create function public.get_mail_connection_credentials(p_org_id uuid, p_connection_id uuid)
returns table (
  connection_id uuid, email_address text, kind text, status text, scopes text[],
  access_token text, refresh_token text, access_token_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.email_address, c.kind, c.status, c.scopes,
         private.decrypt_pii(t.access_token, t.key_version),
         private.decrypt_pii(t.refresh_token, t.key_version),
         t.access_token_expires_at
    from public.mail_connections c
    join public.mail_connection_tokens t on t.connection_id = c.id
   where c.org_id = p_org_id and c.id = p_connection_id and c.status <> 'disconnected'
$$;
revoke all on function public.get_mail_connection_credentials(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_mail_connection_credentials(uuid, uuid) to service_role;

-- A refreshed access token (the refresh token is kept, re-encrypted when the key version moved).
create function public.set_mail_access_token(p_org_id uuid, p_connection_id uuid, p_access_token text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer := private.pii_current_key_version();
begin
  if coalesce(p_access_token, '') = '' or p_expires_at is null then
    raise exception 'A token and its expiry are required' using errcode = '22023';
  end if;
  update public.mail_connection_tokens t
     set access_token = private.encrypt_pii(p_access_token, v_version),
         refresh_token = case when t.key_version = v_version then t.refresh_token
                              else private.encrypt_pii(private.decrypt_pii(t.refresh_token, t.key_version), v_version) end,
         access_token_expires_at = p_expires_at,
         key_version = v_version
   where t.connection_id = p_connection_id and t.org_id = p_org_id;
end;
$$;
revoke all on function public.set_mail_access_token(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_mail_access_token(uuid, uuid, text, timestamptz) to service_role;

-- `needs_reconnect` with its reason (Google refused the refresh), or back to `connected`.
create function public.set_mail_connection_status(p_org_id uuid, p_connection_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('connected', 'needs_reconnect') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  update public.mail_connections c
     set status = p_status, status_reason = case when p_status = 'connected' then null else p_reason end
   where c.id = p_connection_id and c.org_id = p_org_id and c.status <> 'disconnected'
     and (c.status, coalesce(c.status_reason, '')) is distinct from (p_status, coalesce(p_reason, ''));
end;
$$;
revoke all on function public.set_mail_connection_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_mail_connection_status(uuid, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Service RPCs: the sync's state (gmail-sync, gmail-webhook, gmail-watch-renew)
-- -----------------------------------------------------------------------------
-- The webhook's hint: the mailbox named by Google, matched exactly (lower case) among p_org's
-- connected mailboxes, marked due for a sync. Returns the connection id, or null.
create function public.request_mail_sync(p_org_id uuid, p_email_address text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id from public.mail_connections c
   where c.org_id = p_org_id and c.email_address = pg_catalog.lower(coalesce(p_email_address, '')) and c.status = 'connected';
  if v_id is null then return null; end if;
  update public.mail_sync_state s set sync_requested_at = pg_catalog.now()
   where s.connection_id = v_id and s.org_id = p_org_id;
  return v_id;
end;
$$;
revoke all on function public.request_mail_sync(uuid, text) from public, anon, authenticated;
grant execute on function public.request_mail_sync(uuid, text) to service_role;

-- The mailboxes of p_org a sync run looks at (connected ones), with what the run needs to decide.
create function public.list_mail_connections_to_sync(p_org_id uuid)
returns table (
  connection_id uuid, email_address text, status text, history_id bigint,
  sync_requested_at timestamptz, last_sync_at timestamptz, initial_sync_done boolean,
  initial_sync_page_token text, watch_expires_at timestamptz, lease_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.email_address, c.status, s.history_id, s.sync_requested_at, s.last_sync_at,
         s.initial_sync_done, s.initial_sync_page_token, s.watch_expires_at, s.lease_until
    from public.mail_connections c
    join public.mail_sync_state s on s.connection_id = c.id
   where c.org_id = p_org_id and c.status = 'connected'
   order by c.connected_at
$$;
revoke all on function public.list_mail_connections_to_sync(uuid) from public, anon, authenticated;
grant execute on function public.list_mail_connections_to_sync(uuid) to service_role;

-- Takes the sync lease of a mailbox for p_seconds (60 to 900) under p_token: true when taken (the
-- lease was free, lapsed, or already p_token's). Serialised by the row lock of the update.
create function public.acquire_mail_sync_lease(p_org_id uuid, p_connection_id uuid, p_token uuid, p_seconds int default 300)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_seconds is null or p_seconds not between 60 and 900 then
    raise exception 'A token and a lease between 60 and 900 s are required' using errcode = '22023';
  end if;
  update public.mail_sync_state s
     set lease_token = p_token,
         lease_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_seconds),
         last_sync_started_at = pg_catalog.now()
   where s.connection_id = p_connection_id and s.org_id = p_org_id
     and (s.lease_until is null or s.lease_until < pg_catalog.now() or s.lease_token = p_token);
  return found;
end;
$$;
revoke all on function public.acquire_mail_sync_lease(uuid, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.acquire_mail_sync_lease(uuid, uuid, uuid, int) to service_role;

-- Ends a sync under its lease: the history id reached (kept when null), the pass's outcome, the
-- first pass's progress, the messages counted. Releases the lease only when p_token still holds
-- it (a taken-over lease is left to its new holder). Returns false when the token no longer matches
-- (the state is then not written either).
create function public.finish_mail_sync(
  p_org_id uuid, p_connection_id uuid, p_token uuid,
  p_history_id bigint, p_status text, p_error_code text,
  p_initial_sync_done boolean, p_initial_sync_page_token text, p_messages int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('ok', 'error') or (p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,64}$') then
    raise exception 'Unknown status or malformed error code' using errcode = '22023';
  end if;
  update public.mail_sync_state s
     set lease_token = null, lease_until = null,
         history_id = coalesce(p_history_id, s.history_id),
         last_sync_status = p_status,
         last_sync_at = case when p_status = 'ok' then pg_catalog.now() else s.last_sync_at end,
         last_error_code = case when p_status = 'ok' then null else p_error_code end,
         last_error_at = case when p_status = 'ok' then null else pg_catalog.now() end,
         initial_sync_done = coalesce(p_initial_sync_done, s.initial_sync_done),
         initial_sync_page_token = case when coalesce(p_initial_sync_done, s.initial_sync_done) then null
                                        else coalesce(p_initial_sync_page_token, s.initial_sync_page_token) end,
         messages_synced = s.messages_synced + greatest(coalesce(p_messages, 0), 0)
   where s.connection_id = p_connection_id and s.org_id = p_org_id and s.lease_token = p_token;
  return found;
end;
$$;
revoke all on function public.finish_mail_sync(uuid, uuid, uuid, bigint, text, text, boolean, text, int)
  from public, anon, authenticated;
grant execute on function public.finish_mail_sync(uuid, uuid, uuid, bigint, text, text, boolean, text, int) to service_role;

-- Forgets the history id (Gmail answered 404 / 410: the id is too old): the next pass is a full one.
create function public.reset_mail_history(p_org_id uuid, p_connection_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.mail_sync_state s
     set history_id = null, initial_sync_done = false, initial_sync_page_token = null
   where s.connection_id = p_connection_id and s.org_id = p_org_id
$$;
revoke all on function public.reset_mail_history(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reset_mail_history(uuid, uuid) to service_role;

-- The watch Google confirmed (`users.watch`): its expiry and history id; nulls after `users.stop`.
create function public.set_mail_watch(p_org_id uuid, p_connection_id uuid, p_expires_at timestamptz, p_history_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.mail_sync_state s
     set watch_expires_at = p_expires_at, watch_history_id = p_history_id
   where s.connection_id = p_connection_id and s.org_id = p_org_id
$$;
revoke all on function public.set_mail_watch(uuid, uuid, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.set_mail_watch(uuid, uuid, timestamptz, bigint) to service_role;

-- -----------------------------------------------------------------------------
-- Service RPCs: the mirror (gmail-sync)
-- -----------------------------------------------------------------------------
-- The mailbox's labels, replaced as a set (a label Gmail no longer lists is deleted).
create function public.upsert_mail_labels(p_org_id uuid, p_connection_id uuid, p_labels jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_labels is null or jsonb_typeof(p_labels) <> 'array' or jsonb_array_length(p_labels) > 500 then
    raise exception 'Labels must be an array of at most 500' using errcode = '22023';
  end if;
  if not exists (select 1 from public.mail_connections c where c.id = p_connection_id and c.org_id = p_org_id) then
    raise exception 'Unknown connection' using errcode = '22023';
  end if;
  insert into public.mail_labels as l (connection_id, gmail_label_id, org_id, name, type, visibility, color_background, color_text)
  select p_connection_id, x.id, p_org_id, pg_catalog.left(x.name, 225), x.type, x.visibility, x.color_background, x.color_text
    from jsonb_to_recordset(p_labels)
           as x(id text, name text, type text, visibility text, color_background text, color_text text)
   where x.id ~ '^[A-Za-z0-9_-]{1,100}$' and coalesce(x.name, '') <> '' and x.type in ('system', 'user')
  on conflict (connection_id, gmail_label_id) do update
    set name = excluded.name, type = excluded.type, visibility = excluded.visibility,
        color_background = excluded.color_background, color_text = excluded.color_text
    where (l.name, l.type, l.visibility, l.color_background, l.color_text)
          is distinct from (excluded.name, excluded.type, excluded.visibility, excluded.color_background, excluded.color_text);
  delete from public.mail_labels l
   where l.connection_id = p_connection_id and l.org_id = p_org_id
     and not (l.gmail_label_id in (select x->>'id' from jsonb_array_elements(p_labels) x));
  select count(*) into v_count from public.mail_labels l where l.connection_id = p_connection_id;
  return v_count;
end;
$$;
revoke all on function public.upsert_mail_labels(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_mail_labels(uuid, uuid, jsonb) to service_role;

-- Recomputes the summaries of threads: counts, unread (outside TRASH and SPAM), attachments, the
-- union of labels, the first message's subject, the last message's snippet and sender. A thread
-- left with no message is deleted (its link goes with it).
create function private.refresh_mail_threads(p_org uuid, p_thread_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.mail_threads t
     set subject = f.subject,
         snippet = l.snippet,
         last_from_name = l.from_name,
         last_from_address = l.from_address,
         first_message_at = a.first_at,
         last_message_at = a.last_at,
         message_count = a.n,
         unread_count = a.unread,
         has_attachments = a.has_att,
         label_ids = a.labels
    from (select m.thread_id,
                 min(m.sent_at) as first_at, max(m.sent_at) as last_at, count(*)::int as n,
                 count(*) filter (where m.is_unread and not (m.label_ids && array['TRASH', 'SPAM']))::int as unread,
                 bool_or(m.has_attachments) as has_att,
                 coalesce((select array_agg(distinct x) from unnest(array_agg(m.label_ids)) as y(arr), unnest(y.arr) as x), '{}') as labels
            from public.mail_messages m
           where m.org_id = p_org and m.thread_id = any (p_thread_ids)
           group by m.thread_id) a
    join lateral (select m.subject from public.mail_messages m where m.thread_id = a.thread_id
                   order by m.sent_at, m.id limit 1) f on true
    join lateral (select m.snippet, m.from_name, m.from_address from public.mail_messages m where m.thread_id = a.thread_id
                   order by m.sent_at desc, m.id desc limit 1) l on true
   where t.id = a.thread_id and t.org_id = p_org;
  delete from public.mail_threads t
   where t.org_id = p_org and t.id = any (p_thread_ids)
     and not exists (select 1 from public.mail_messages m where m.thread_id = t.id);
end;
$$;
revoke all on function private.refresh_mail_threads(uuid, uuid[]) from public, anon, authenticated, service_role;

-- Writes a batch of messages read from Gmail (at most 50): the threads they belong to (created
-- with an `unlinked` link row), the messages (inserted, or updated in place: labels, unread, the
-- bodies when the row has none yet and is not purged), their attachment parts (`pending` for the
-- accepted types, `unsupported_type` or `too_large` otherwise; an existing part keeps its status
-- and file), then the threads' summaries. Each element:
--   { gmail_message_id, gmail_thread_id, rfc_message_id?, in_reply_to?, from_name?, from_address?,
--     to?: [{name, address}], cc?, bcc?, reply_to_address?, subject?, snippet?, sent_at (ISO),
--     label_ids: [], body_html?, body_text?, size_estimate?,
--     attachments?: [{ part_id, gmail_attachment_id?, filename?, mime_type?, size_bytes?, content_id?, is_inline, accepted }] }
-- Returns (message_id, gmail_message_id, inserted) for each element written.
create function public.upsert_mail_messages(p_org_id uuid, p_connection_id uuid, p_messages jsonb)
returns table (message_id uuid, gmail_message_id text, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_thread_ids uuid[];
begin
  if p_messages is null or jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 50 then
    raise exception 'Messages must be an array of at most 50' using errcode = '22023';
  end if;
  select c.email_address into v_email from public.mail_connections c
   where c.id = p_connection_id and c.org_id = p_org_id and c.status <> 'disconnected';
  if v_email is null then
    raise exception 'Unknown or disconnected connection' using errcode = '22023';
  end if;

  create temp table if not exists tmp_mail_in (
    gmail_message_id text, gmail_thread_id text, rfc_message_id text, in_reply_to text,
    from_name text, from_address text, to_addresses jsonb, cc_addresses jsonb, bcc_addresses jsonb,
    reply_to_address text, subject text, snippet text, sent_at timestamptz, label_ids text[],
    body_html text, body_text text, size_estimate int, attachments jsonb
  ) on commit drop;
  delete from tmp_mail_in;
  insert into tmp_mail_in
  select x.gmail_message_id, x.gmail_thread_id,
         pg_catalog.left(x.rfc_message_id, 998), pg_catalog.left(x.in_reply_to, 998),
         pg_catalog.left(x.from_name, 500), pg_catalog.lower(pg_catalog.left(x.from_address, 320)),
         coalesce(x."to", '[]'::jsonb), coalesce(x.cc, '[]'::jsonb), coalesce(x.bcc, '[]'::jsonb),
         pg_catalog.lower(pg_catalog.left(x.reply_to_address, 320)),
         pg_catalog.left(x.subject, 2000), pg_catalog.left(x.snippet, 1000), x.sent_at, coalesce(x.label_ids, '{}'),
         pg_catalog.left(x.body_html, 1048576), pg_catalog.left(x.body_text, 1048576), x.size_estimate,
         coalesce(x.attachments, '[]'::jsonb)
    from jsonb_to_recordset(p_messages) as x(
           gmail_message_id text, gmail_thread_id text, rfc_message_id text, in_reply_to text,
           from_name text, from_address text, "to" jsonb, cc jsonb, bcc jsonb, reply_to_address text,
           subject text, snippet text, sent_at timestamptz, label_ids text[], body_html text, body_text text,
           size_estimate int, attachments jsonb)
   where x.gmail_message_id ~ '^[A-Za-z0-9_-]{1,64}$' and x.gmail_thread_id ~ '^[A-Za-z0-9_-]{1,64}$' and x.sent_at is not null;

  -- Threads, then their link rows.
  insert into public.mail_threads (org_id, connection_id, gmail_thread_id)
  select distinct p_org_id, p_connection_id, i.gmail_thread_id from tmp_mail_in i
  on conflict (connection_id, gmail_thread_id) do nothing;
  insert into public.mail_thread_links (thread_id, org_id)
  select t.id, p_org_id from public.mail_threads t
   where t.connection_id = p_connection_id and t.gmail_thread_id in (select i.gmail_thread_id from tmp_mail_in i)
  on conflict (thread_id) do nothing;

  -- Messages: new rows, or the mutable fields of known ones.
  create temp table if not exists tmp_mail_out (message_id uuid, gmail_message_id text, inserted boolean) on commit drop;
  delete from tmp_mail_out;
  insert into tmp_mail_out
  select m.id, m.gmail_message_id, (m.xmax = 0)
    from (
      insert into public.mail_messages as m (
        org_id, connection_id, thread_id, gmail_message_id, rfc_message_id, in_reply_to,
        from_name, from_address, to_addresses, cc_addresses, bcc_addresses, reply_to_address,
        subject, snippet, sent_at, label_ids, is_unread, is_inbound, has_attachments,
        body_html, body_text, size_estimate)
      select p_org_id, p_connection_id, t.id, i.gmail_message_id, i.rfc_message_id, i.in_reply_to,
             i.from_name, i.from_address, i.to_addresses, i.cc_addresses, i.bcc_addresses, i.reply_to_address,
             i.subject, i.snippet, i.sent_at, i.label_ids,
             'UNREAD' = any (i.label_ids),
             not ('SENT' = any (i.label_ids)) and coalesce(i.from_address, '') <> v_email,
             exists (select 1 from jsonb_array_elements(i.attachments) a where coalesce((a->>'is_inline')::boolean, false) = false),
             i.body_html, i.body_text, i.size_estimate
        from tmp_mail_in i
        join public.mail_threads t on t.connection_id = p_connection_id and t.gmail_thread_id = i.gmail_thread_id
      on conflict (connection_id, gmail_message_id) do update
        set label_ids = excluded.label_ids,
            is_unread = excluded.is_unread,
            snippet = case when m.body_purged_at is null then excluded.snippet else m.snippet end,
            body_html = case when m.body_purged_at is null then coalesce(m.body_html, excluded.body_html) else m.body_html end,
            body_text = case when m.body_purged_at is null then coalesce(m.body_text, excluded.body_text) else m.body_text end,
            has_attachments = excluded.has_attachments,
            size_estimate = coalesce(excluded.size_estimate, m.size_estimate)
      returning m.id, m.gmail_message_id, m.xmax
    ) m;

  -- Attachment parts (an existing part keeps its status and file).
  insert into public.mail_attachments (org_id, message_id, part_id, gmail_attachment_id, filename, mime_type, size_bytes, content_id, is_inline, status)
  select p_org_id, o.message_id, a.part_id, pg_catalog.left(a.gmail_attachment_id, 512), pg_catalog.left(a.filename, 255),
         pg_catalog.lower(a.mime_type), a.size_bytes, pg_catalog.left(a.content_id, 998), coalesce(a.is_inline, false),
         case when not coalesce(a.accepted, false) then 'unsupported_type'
              when coalesce(a.size_bytes, 0) > 10485760 then 'too_large'
              else 'pending' end
    from tmp_mail_in i
    join tmp_mail_out o on o.gmail_message_id = i.gmail_message_id
    cross join lateral jsonb_to_recordset(i.attachments) as a(
           part_id text, gmail_attachment_id text, filename text, mime_type text, size_bytes int,
           content_id text, is_inline boolean, accepted boolean)
   where a.part_id ~ '^[0-9.]{1,32}$' and (a.mime_type is null or pg_catalog.lower(a.mime_type) ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$')
  on conflict (message_id, part_id) do update
    set gmail_attachment_id = excluded.gmail_attachment_id;

  select array_agg(distinct m.thread_id) into v_thread_ids
    from public.mail_messages m where m.id in (select o.message_id from tmp_mail_out o);
  perform private.refresh_mail_threads(p_org_id, coalesce(v_thread_ids, '{}'));

  return query select o.message_id, o.gmail_message_id, o.inserted from tmp_mail_out o;
end;
$$;
revoke all on function public.upsert_mail_messages(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_mail_messages(uuid, uuid, jsonb) to service_role;

-- Messages Gmail deleted for good (history `messagesDeleted`): their rows and attachment files
-- go (the files soft-deleted; storage-cleanup removes the objects), the threads refreshed.
create function public.delete_mail_messages(p_org_id uuid, p_connection_id uuid, p_gmail_message_ids text[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread_ids uuid[];
  v_count int;
  r record;
begin
  if p_gmail_message_ids is null or pg_catalog.cardinality(p_gmail_message_ids) > 500 then
    raise exception 'Between 0 and 500 ids' using errcode = '22023';
  end if;
  for r in select a.stored_file_id from public.mail_attachments a
            join public.mail_messages m on m.id = a.message_id
           where m.org_id = p_org_id and m.connection_id = p_connection_id
             and m.gmail_message_id = any (p_gmail_message_ids) and a.stored_file_id is not null
  loop
    perform private.soft_delete_stored_file(r.stored_file_id, null);
  end loop;
  with gone as (
    delete from public.mail_messages m
     where m.org_id = p_org_id and m.connection_id = p_connection_id and m.gmail_message_id = any (p_gmail_message_ids)
    returning m.thread_id)
  select array_agg(distinct g.thread_id), count(*)::int into v_thread_ids, v_count from gone g;
  perform private.refresh_mail_threads(p_org_id, coalesce(v_thread_ids, '{}'));
  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.delete_mail_messages(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.delete_mail_messages(uuid, uuid, text[]) to service_role;

-- Label changes from Gmail's history (`labelsAdded`, `labelsRemoved`) or from gmail-modify, for
-- known messages: `[{ gmail_message_id, add: [], remove: [] }]` (at most 500). Unknown ids are
-- ignored (the sync fetches them as new messages). Returns the rows changed.
create function public.apply_mail_label_changes(p_org_id uuid, p_connection_id uuid, p_changes jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread_ids uuid[];
  v_count int;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 500 then
    raise exception 'Changes must be an array of at most 500' using errcode = '22023';
  end if;
  with c as (
    select x.gmail_message_id, coalesce(x."add", '{}') as add_ids, coalesce(x."remove", '{}') as remove_ids
      from jsonb_to_recordset(p_changes) as x(gmail_message_id text, "add" text[], "remove" text[])
  ), changed as (
    update public.mail_messages m
       set label_ids = (select coalesce(array_agg(distinct l), '{}') from unnest(m.label_ids || c.add_ids) l
                         where not (l = any (c.remove_ids))),
           is_unread = ('UNREAD' = any (m.label_ids || c.add_ids)) and not ('UNREAD' = any (c.remove_ids))
      from c
     where m.org_id = p_org_id and m.connection_id = p_connection_id and m.gmail_message_id = c.gmail_message_id
       and (c.add_ids <> '{}' or c.remove_ids <> '{}')
    returning m.thread_id)
  select array_agg(distinct ch.thread_id), count(*)::int into v_thread_ids, v_count from changed ch;
  perform private.refresh_mail_threads(p_org_id, coalesce(v_thread_ids, '{}'));
  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.apply_mail_label_changes(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_mail_label_changes(uuid, uuid, jsonb) to service_role;

-- The attachments of a mailbox still to copy (oldest first, at most p_limit ≤ 100), with what the
-- copy needs: the message's Gmail id and the part's attachment id.
create function public.list_mail_attachments_to_store(p_org_id uuid, p_connection_id uuid, p_limit int default 20)
returns table (attachment_id uuid, message_id uuid, gmail_message_id text, gmail_attachment_id text,
               part_id text, filename text, mime_type text, size_bytes int, attempts int)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, m.id, m.gmail_message_id, a.gmail_attachment_id, a.part_id, a.filename, a.mime_type, a.size_bytes, a.attempts
    from public.mail_attachments a
    join public.mail_messages m on m.id = a.message_id
   where a.org_id = p_org_id and m.connection_id = p_connection_id and a.status = 'pending' and a.attempts < 5
   order by a.created_at
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;
revoke all on function public.list_mail_attachments_to_store(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.list_mail_attachments_to_store(uuid, uuid, int) to service_role;

-- The outcome of one copy: `stored` with the file (registered by register_system_file and
-- uploaded), or a failure (`failed` for good, else `pending` again with one more attempt).
create function public.record_mail_attachment(p_org_id uuid, p_attachment_id uuid, p_status text, p_stored_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('stored', 'pending', 'failed', 'too_large', 'unsupported_type')
     or (p_status = 'stored') <> (p_stored_file_id is not null) then
    raise exception 'Unknown status, or a stored outcome without its file' using errcode = '22023';
  end if;
  if p_stored_file_id is not null and not exists (
       select 1 from public.stored_files f
        where f.id = p_stored_file_id and f.org_id = p_org_id and f.purpose = 'mail_attachment' and f.status = 'ready') then
    raise exception 'Unknown file' using errcode = '22023';
  end if;
  update public.mail_attachments a
     set status = p_status,
         stored_file_id = coalesce(p_stored_file_id, a.stored_file_id),
         attempts = a.attempts + 1
   where a.id = p_attachment_id and a.org_id = p_org_id and a.status = 'pending';
end;
$$;
revoke all on function public.record_mail_attachment(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_mail_attachment(uuid, uuid, text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Jobs: the sync fallback, the watch renewal, the 24-month purge
-- -----------------------------------------------------------------------------
-- Bodies older than 24 months: snippet and bodies nulled, the attachments' files soft-deleted
-- (status `purged`), in batches of 1 000 messages; the rows and headers stay (CM-8).
create function private.job_mail_bodies_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_batch bigint;
  v_total bigint := 0;
  v_files bigint := 0;
  r record;
begin
  loop
    create temp table if not exists tmp_mail_purge (id uuid) on commit drop;
    delete from tmp_mail_purge;
    insert into tmp_mail_purge
    select m.id from public.mail_messages m
     where m.body_purged_at is null and m.sent_at < pg_catalog.now() - interval '24 months'
     order by m.sent_at
     limit 1000;
    for r in select a.id, a.stored_file_id from public.mail_attachments a
              where a.message_id in (select p.id from tmp_mail_purge p) and a.status <> 'purged'
    loop
      if r.stored_file_id is not null then
        perform private.soft_delete_stored_file(r.stored_file_id, null);
        v_files := v_files + 1;
      end if;
      update public.mail_attachments a set status = 'purged' where a.id = r.id;
    end loop;
    update public.mail_messages m
       set body_html = null, body_text = null, snippet = null, body_purged_at = pg_catalog.now()
     where m.id in (select p.id from tmp_mail_purge p);
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch < 1000;
  end loop;
  return 'purged=' || v_total || ' files=' || v_files;
end;
$$;
revoke all on function private.job_mail_bodies_purge() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('communications.gmail_sync', 'communications', 'Synchronisation Gmail',
   'Relit les boîtes Gmail connectées toutes les 15 minutes, au cas où une notification de Google se serait perdue.',
   'function', 'gmail-sync', null, 'communications.gmail_sync', null, false),
  ('communications.gmail_watch_renew', 'communications', 'Renouvellement de la surveillance Gmail',
   'Renouvelle chaque jour la surveillance Pub/Sub des boîtes Gmail connectées (Google la limite à 7 jours).',
   'function', 'gmail-watch-renew', null, 'communications.gmail_watch_renew', null, false),
  ('communications.mail_bodies_purge', 'communications', 'Effacement des courriels de plus de 24 mois',
   'Efface le contenu et les pièces jointes des courriels synchronisés il y a plus de 24 mois. Les en-têtes restent.',
   'sql', null, 'private.job_mail_bodies_purge', 'communications.mail_bodies_purge', null, true)
on conflict do nothing;

select cron.schedule('communications.gmail_sync', '*/15 * * * *',
  $$select private.invoke_job_function('communications.gmail_sync')$$);
select cron.schedule('communications.gmail_watch_renew', '35 * * * *',
  $$select private.invoke_job_function('communications.gmail_watch_renew')$$);
select cron.schedule('communications.mail_bodies_purge', '45 8 * * *',
  $$select private.run_sql_job('communications.mail_bodies_purge')$$);
