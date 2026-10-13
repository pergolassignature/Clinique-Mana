-- =============================================================================
-- Module Communications, batch CM3: the composer and the Gmail send
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §11 (CM3); roadmap §2.4 bis (PS Hub's
--            composer, its flaws fixed); docs/modules/communications.md « The composer (CM3) »
-- Decisions: CM-14 … CM-17 (this batch)
--
-- * Drafts (`mail_drafts`): each person's own, autosaved by the composer (never in the browser's
--   storage), deleted once sent. Not audited: rewritten every few seconds, and the audit would keep
--   every version of a text that may never be sent (000_invariants lists why).
-- * Templates: the clinic's (core's `email_template_defaults`, module `communications`: edited in
--   Paramètres → Modèles de courriels like every other) and each person's own (`mail_templates`).
--   Placeholders (`{{person.first_name}}`, `{{clinic.name}}`, `{{sender.name}}`) are filled by
--   `gmail-send`, never by the browser: `prepare_mail_send` checks them and hands the values.
-- * The send (`gmail-send`, service role): `prepare_mail_send` checks the actor, the mailbox, the
--   thread, the recipients, the client, the files (only our own stored files: an upload of the
--   actor's, or an attachment of a mirrored message she may read; never a URL) and P3-40, then
--   records the send (`mail_sends`, idempotent by the browser's key); `complete_mail_send` closes
--   it once Gmail answered and the message is mirrored: draft deleted, uploads kept with the send,
--   the new thread linked to the client.
-- * P3-40: while Communications (or Clients, when the message is about a file) is « Réservé aux
--   testeurs », a message to anyone outside the clinic (an address that is neither a staff
--   member's nor one of the clinic's mailboxes) is refused in French.
-- * « Écrire » from a client record: `get_mail_compose_context` (the file's addresses that receive
--   communications, through Clients' `client_contacts_for`) and `list_client_mail_threads`; the
--   record shows them through the new slot `client.messages` (module data, ADR 0003).
-- * The one-time backfill of CM2b (CM-17): `communications.mail_links_backfill`, a maintenance job
--   that hands every thread not linked by a person and with inbound mail to
--   `private.communications_link_threads`, in batches; daily, so a file created after its first
--   email still gets its threads.
-- Additive: tables, functions, catalogue rows, one job; the two CM2b handlers replaced (same
-- signatures).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:communications_composer', true);

-- -----------------------------------------------------------------------------
-- Shared checks
-- -----------------------------------------------------------------------------
-- A list of addresses as the composer sends it: lower case, valid, distinct, at most p_max.
create function private.mail_addresses_valid(p_addresses text[], p_max int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_addresses is not null
     and pg_catalog.cardinality(p_addresses) <= p_max
     and not exists (select 1 from pg_catalog.unnest(p_addresses) a
                      where a is null or a <> pg_catalog.lower(a) or not private.is_mailbox(a))
     and (select pg_catalog.count(distinct a) = pg_catalog.count(*) from pg_catalog.unnest(p_addresses) a)
$$;
revoke all on function private.mail_addresses_valid(text[], int) from public, anon, authenticated, service_role;

-- The placeholders a composed message may use (CM-15), filled by gmail-send.
create function private.mail_compose_placeholders()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['person.first_name', 'person.last_name', 'clinic.name', 'sender.name']
$$;
revoke all on function private.mail_compose_placeholders() from public, anon, authenticated, service_role;

-- The French P0001 message for a subject or body whose placeholders break the rule, or null: the
-- first unknown `{{ … }}`, else a `{{` or `}}` left once the known ones are removed.
create function private.mail_placeholder_error(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_path text;
begin
  for v_path in
    select m[1] from pg_catalog.regexp_matches(coalesce(p_text, ''), '\{\{\s*([^{}]*?)\s*\}\}', 'g') m
  loop
    if not (v_path = any (private.mail_compose_placeholders())) then
      return pg_catalog.format('Variable inconnue : {{%s}}.', pg_catalog.left(v_path, 60));
    end if;
  end loop;
  if pg_catalog.regexp_replace(coalesce(p_text, ''), '\{\{\s*[a-z_.]+\s*\}\}', '', 'g') ~ '\{\{|\}\}' then
    return 'Une variable est mal écrite : elle s''écrit entre {{ et }}.';
  end if;
  return null;
end;
$$;
revoke all on function private.mail_placeholder_error(text) from public, anon, authenticated, service_role;

-- The mailbox p_connection of p_org that p_actor may read (shared, or her own), or null.
create function private.mail_connection_for(p_org uuid, p_actor uuid, p_connection uuid)
returns public.mail_connections
language sql
stable
set search_path = ''
as $$
  select c.* from public.mail_connections c
   where c.id = p_connection and c.org_id = p_org
     and (c.kind = 'shared' or c.owner_profile_id = p_actor)
$$;
revoke all on function private.mail_connection_for(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The composer's uploads
-- -----------------------------------------------------------------------------
-- A file the composer attaches (« Joindre »): uploaded with communications.inbox, read with it,
-- kept 30 days unless sent (then kept with the send, CM-16).
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('mail_outgoing', 'communications', 'documents', 'communications.inbox', 'communications.inbox', null,
   10485760,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
   null, 30)
on conflict do nothing;

-- The files p_actor may attach in p_org (CM-16): her own uploads for the composer, or a mirrored
-- message's attachment she may read (a forward); ready, of the clinic. Others are absent.
create function private.mail_files_for(p_org uuid, p_actor uuid, p_file_ids uuid[])
returns table (id uuid, bucket text, object_path text, original_name text, mime_type text, size_bytes int, purpose text)
language sql
stable
set search_path = ''
as $$
  select f.id, f.bucket, f.object_path, f.original_name, f.mime_type, f.size_bytes, f.purpose
    from public.stored_files f
   where f.org_id = p_org and f.id = any (p_file_ids) and f.status = 'ready'
     and (f.retain_until is null or f.retain_until > pg_catalog.now())
     and ((f.purpose = 'mail_outgoing' and f.uploaded_by = p_actor)
          or (f.purpose = 'mail_attachment'
              and (f.view_permission is null or f.view_permission = any (private.permission_keys_for(p_actor)))))
$$;
revoke all on function private.mail_files_for(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- mail_drafts: each person's drafts (not audited: see the header)
-- -----------------------------------------------------------------------------
create table public.mail_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  connection_id uuid not null references public.mail_connections(id) on delete cascade,
  -- `new`, `reply`, `reply_all`, `forward`.
  mode text not null default 'new',
  -- The thread answered or forwarded, and the message it answers (null once gone).
  thread_id uuid references public.mail_threads(id) on delete set null,
  reply_to_message_id uuid references public.mail_messages(id) on delete set null,
  -- The file it is about (« Écrire » from a record, or the thread's link); no FK: Clients is optional.
  client_id uuid,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  bcc_addresses text[] not null default '{}',
  subject text not null default '',
  body_html text not null default '',
  attachment_file_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, org_id) references public.profiles (user_id, org_id) on delete cascade,
  constraint mail_drafts_mode_check check (mode in ('new', 'reply', 'reply_all', 'forward')),
  constraint mail_drafts_addresses_check check (
    private.mail_addresses_valid(to_addresses, 50) and private.mail_addresses_valid(cc_addresses, 50)
    and private.mail_addresses_valid(bcc_addresses, 50)),
  constraint mail_drafts_subject_check check (pg_catalog.length(subject) <= 250 and subject !~ '[\r\n]'),
  constraint mail_drafts_body_check check (pg_catalog.octet_length(body_html) <= 524288),
  constraint mail_drafts_files_check check (pg_catalog.cardinality(attachment_file_ids) <= 10)
);
create index mail_drafts_org_id_idx on public.mail_drafts (org_id);
create index mail_drafts_user_idx on public.mail_drafts (user_id, org_id, updated_at desc);
create index mail_drafts_connection_id_idx on public.mail_drafts (connection_id);
create index mail_drafts_thread_id_idx on public.mail_drafts (thread_id);
create index mail_drafts_reply_to_message_id_idx on public.mail_drafts (reply_to_message_id);
create index mail_drafts_client_id_idx on public.mail_drafts (client_id) where client_id is not null;

create trigger mail_drafts_set_updated_at before update on public.mail_drafts
  for each row execute function private.set_updated_at();

alter table public.mail_drafts enable row level security;
revoke all on public.mail_drafts from anon, authenticated;
grant select on public.mail_drafts to authenticated;
create policy mail_drafts_select on public.mail_drafts
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and user_id = (select auth.uid())
    and (select private.has_permission('communications.inbox'))
  );

-- -----------------------------------------------------------------------------
-- mail_templates: each person's own templates (audited, the body redacted)
-- -----------------------------------------------------------------------------
create table public.mail_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null,
  name text not null,
  subject text not null default '',
  body_html text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, org_id) references public.profiles (user_id, org_id) on delete cascade,
  constraint mail_templates_name_check check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'),
  constraint mail_templates_subject_check check (pg_catalog.length(subject) <= 250 and subject !~ '[\r\n]'),
  constraint mail_templates_body_check check (pg_catalog.octet_length(body_html) between 1 and 102400)
);
create index mail_templates_org_id_idx on public.mail_templates (org_id);
create unique index mail_templates_owner_name_idx on public.mail_templates (owner_id, org_id, pg_catalog.lower(name));

create trigger mail_templates_set_updated_at before update on public.mail_templates
  for each row execute function private.set_updated_at();
create trigger mail_templates_audit after insert or update or delete on public.mail_templates
  for each row execute function private.audit_trigger('body_html');

alter table public.mail_templates enable row level security;
revoke all on public.mail_templates from anon, authenticated;
grant select on public.mail_templates to authenticated;
create policy mail_templates_select on public.mail_templates
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and owner_id = (select auth.uid())
    and (select private.has_permission('communications.inbox'))
  );

-- The clinic's templates (core's catalogue): starting texts, edited in Paramètres → Modèles de
-- courriels. Plain text, as every core template; the composer turns the paragraphs into HTML.
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission, recipient_mode)
values
  ('communications.acknowledgement', 'communications',
   'Accusé de réception',
   'Texte de départ du composeur « Courriels » : on a bien reçu le message, une conseillère répond bientôt.',
   'Modèle du composeur : cette ligne n''est pas ajoutée aux courriels écrits dans « Courriels ».',
   'Votre message à {{clinic.name}}',
   E'Bonjour {{person.first_name}},\n\n'
   'Merci pour votre message. Nous l''avons bien reçu et une conseillère vous répondra dans les prochains jours ouvrables.\n\n'
   'Au plaisir,\n{{sender.name}}\n{{clinic.name}}',
   null,
   '[
     {"path": "person.first_name", "label": "Prénom de la personne", "sample": "Camille", "required": false, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "sender.name", "label": "Votre nom", "sample": "Julie Gagnon", "required": true, "kind": "text"}
   ]',
   'communications.inbox', 'free'),
  ('communications.follow_up', 'communications',
   'Relance',
   'Texte de départ du composeur « Courriels » : un suivi quand la personne n''a pas encore répondu.',
   'Modèle du composeur : cette ligne n''est pas ajoutée aux courriels écrits dans « Courriels ».',
   'Suivi de votre demande — {{clinic.name}}',
   E'Bonjour {{person.first_name}},\n\n'
   'Nous revenons vers vous au sujet de votre demande. Si vous souhaitez toujours prendre rendez-vous, il suffit de répondre à ce courriel.\n\n'
   'Au plaisir,\n{{sender.name}}\n{{clinic.name}}',
   null,
   '[
     {"path": "person.first_name", "label": "Prénom de la personne", "sample": "Camille", "required": false, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "sender.name", "label": "Votre nom", "sample": "Julie Gagnon", "required": true, "kind": "text"}
   ]',
   'communications.inbox', 'free')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- mail_sends: what was sent from the app (audited; ids and counts, never an address or a text)
-- -----------------------------------------------------------------------------
create table public.mail_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.mail_connections(id) on delete cascade,
  sent_by uuid references public.profiles(user_id) on delete set null,
  -- The browser's key for one « Envoyer »: a retried request never sends twice.
  send_key uuid not null,
  mode text not null,
  thread_id uuid references public.mail_threads(id) on delete set null,
  client_id uuid,
  draft_id uuid,
  template_key text,
  recipient_count int not null check (recipient_count between 1 and 150),
  -- The composer's uploads and the forwarded attachments.
  file_ids uuid[] not null default '{}',
  -- `pending` (Gmail asked), `sent`, `failed` (a retry with the same key tries again).
  status text not null default 'pending',
  error_code text,
  gmail_message_id text,
  gmail_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (org_id, send_key),
  constraint mail_sends_mode_check check (mode in ('new', 'reply', 'reply_all', 'forward')),
  constraint mail_sends_status_check check (status in ('pending', 'sent', 'failed')),
  constraint mail_sends_error_check check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  constraint mail_sends_sent_check check (status <> 'sent' or (gmail_message_id is not null and sent_at is not null))
);
create index mail_sends_connection_id_idx on public.mail_sends (connection_id);
create index mail_sends_sent_by_idx on public.mail_sends (sent_by);
create index mail_sends_thread_id_idx on public.mail_sends (thread_id);
create index mail_sends_client_id_idx on public.mail_sends (client_id) where client_id is not null;

create trigger mail_sends_set_updated_at before update on public.mail_sends
  for each row execute function private.set_updated_at();
create trigger mail_sends_audit after insert or update or delete on public.mail_sends
  for each row execute function private.audit_trigger();

-- Read by nobody from the browser (the audit journal shows who sent what).
alter table public.mail_sends enable row level security;
revoke all on public.mail_sends from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Drafts (communications.inbox; each person her own)
-- -----------------------------------------------------------------------------
-- Saves the caller's draft p_id (null: a new one) from p_draft {connection_id, mode, thread_id,
-- reply_to_message_id, client_id, to, cc, bcc, subject, body_html, file_ids}; returns its id and
-- its time. Every id is checked (her mailbox, its thread, the thread's message, a file of the
-- clinic with clients.view, her own files); a refusal is a French P0001 with a HINT.
create function public.save_mail_draft(p_id uuid, p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_user uuid := auth.uid();
  v_connection uuid;
  v_thread uuid;
  v_message uuid;
  v_client uuid;
  v_mode text;
  v_to text[];
  v_cc text[];
  v_bcc text[];
  v_files uuid[];
  v_row public.mail_drafts;
begin
  if not private.has_permission('communications.inbox') then
    raise exception 'Permission refusée : communications.inbox' using errcode = '42501';
  end if;
  if p_draft is null or pg_catalog.jsonb_typeof(p_draft) <> 'object' then
    raise exception 'Invalid draft' using errcode = '22023';
  end if;
  v_connection := nullif(p_draft ->> 'connection_id', '')::uuid;
  v_thread := nullif(p_draft ->> 'thread_id', '')::uuid;
  v_message := nullif(p_draft ->> 'reply_to_message_id', '')::uuid;
  v_client := nullif(p_draft ->> 'client_id', '')::uuid;
  v_mode := coalesce(p_draft ->> 'mode', 'new');
  select coalesce(pg_catalog.array_agg(distinct pg_catalog.lower(pg_catalog.btrim(x))), '{}') into v_to
    from pg_catalog.jsonb_array_elements_text(coalesce(p_draft -> 'to', '[]')) x where pg_catalog.btrim(x) <> '';
  select coalesce(pg_catalog.array_agg(distinct pg_catalog.lower(pg_catalog.btrim(x))), '{}') into v_cc
    from pg_catalog.jsonb_array_elements_text(coalesce(p_draft -> 'cc', '[]')) x where pg_catalog.btrim(x) <> '';
  select coalesce(pg_catalog.array_agg(distinct pg_catalog.lower(pg_catalog.btrim(x))), '{}') into v_bcc
    from pg_catalog.jsonb_array_elements_text(coalesce(p_draft -> 'bcc', '[]')) x where pg_catalog.btrim(x) <> '';
  select coalesce(pg_catalog.array_agg(distinct x::uuid), '{}') into v_files
    from pg_catalog.jsonb_array_elements_text(coalesce(p_draft -> 'file_ids', '[]')) x;

  if v_connection is null or not (v_connection = any (private.readable_mail_connection_ids())) then
    raise exception 'Choisissez une boîte de la clinique.' using errcode = 'P0001', hint = 'connection_id';
  end if;
  if v_mode not in ('new', 'reply', 'reply_all', 'forward') then
    raise exception 'Invalid mode' using errcode = '22023';
  end if;
  if v_thread is not null and not exists (
       select 1 from public.mail_threads t where t.id = v_thread and t.connection_id = v_connection) then
    raise exception 'Ce fil n''existe pas.' using errcode = 'P0001', hint = 'thread_id';
  end if;
  if v_message is not null and (v_thread is null or not exists (
       select 1 from public.mail_messages m where m.id = v_message and m.thread_id = v_thread)) then
    raise exception 'Ce message n''existe pas.' using errcode = 'P0001', hint = 'reply_to_message_id';
  end if;
  if v_mode <> 'new' and v_thread is null then
    raise exception 'Une réponse ou un transfert part d''un fil.' using errcode = 'P0001', hint = 'thread_id';
  end if;
  if v_client is not null and (not private.has_permission('clients.view') or not exists (
       select 1 from public.clients_directory c
        where c.id = v_client and c.org_id = v_org and c.merged_into_id is null and not c.is_anonymized)) then
    raise exception 'Choisissez un dossier client de la clinique.' using errcode = 'P0001', hint = 'client_id';
  end if;
  if not (private.mail_addresses_valid(v_to, 50) and private.mail_addresses_valid(v_cc, 50)
          and private.mail_addresses_valid(v_bcc, 50)) then
    raise exception 'Une adresse n''est pas valide.' using errcode = 'P0001', hint = 'to';
  end if;
  if pg_catalog.cardinality(v_files) > 10 then
    raise exception 'Dix pièces jointes au plus.' using errcode = 'P0001', hint = 'file_ids';
  end if;
  if (select pg_catalog.count(*) from private.mail_files_for(v_org, v_user, v_files)) <> pg_catalog.cardinality(v_files) then
    raise exception 'Une pièce jointe est introuvable.' using errcode = 'P0001', hint = 'file_ids';
  end if;

  if p_id is null then
    if (select pg_catalog.count(*) from public.mail_drafts d where d.user_id = v_user and d.org_id = v_org) >= 50 then
      raise exception 'Vous avez déjà 50 brouillons : envoyez-en ou supprimez-en un.' using errcode = 'P0001', hint = 'drafts';
    end if;
    insert into public.mail_drafts (org_id, user_id, connection_id, mode, thread_id, reply_to_message_id, client_id,
                                    to_addresses, cc_addresses, bcc_addresses, subject, body_html, attachment_file_ids)
    values (v_org, v_user, v_connection, v_mode, v_thread, v_message, v_client, v_to, v_cc, v_bcc,
            coalesce(p_draft ->> 'subject', ''), coalesce(p_draft ->> 'body_html', ''), v_files)
    returning * into v_row;
  else
    update public.mail_drafts d
       set connection_id = v_connection, mode = v_mode, thread_id = v_thread, reply_to_message_id = v_message,
           client_id = v_client, to_addresses = v_to, cc_addresses = v_cc, bcc_addresses = v_bcc,
           subject = coalesce(p_draft ->> 'subject', ''), body_html = coalesce(p_draft ->> 'body_html', ''),
           attachment_file_ids = v_files
     where d.id = p_id and d.user_id = v_user and d.org_id = v_org
    returning * into v_row;
    if v_row.id is null then
      raise exception 'Ce brouillon n''existe plus.' using errcode = 'P0001', hint = 'draft_gone';
    end if;
  end if;
  return pg_catalog.jsonb_build_object('id', v_row.id, 'updated_at', v_row.updated_at);
exception
  when check_violation then
    raise exception 'Le brouillon est trop long ou un champ n''est pas valide.' using errcode = 'P0001', hint = 'draft';
end;
$$;
revoke all on function public.save_mail_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_mail_draft(uuid, jsonb) to authenticated;

-- « Supprimer le brouillon » (the caller's own; nothing when it is already gone). The uploads it
-- held expire with their purpose (30 days).
create function public.delete_mail_draft(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('communications.inbox') then
    raise exception 'Permission refusée : communications.inbox' using errcode = '42501';
  end if;
  delete from public.mail_drafts d
   where d.id = p_id and d.user_id = auth.uid() and d.org_id = private.current_user_org_id();
end;
$$;
revoke all on function public.delete_mail_draft(uuid) from public, anon, authenticated;
grant execute on function public.delete_mail_draft(uuid) to authenticated;

-- The caller's drafts, newest first (the list « Brouillons »): no body.
create function public.list_mail_drafts()
returns table (id uuid, connection_id uuid, mode text, thread_id uuid, client_id uuid, subject text,
               to_addresses text[], attachment_count int, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id, d.connection_id, d.mode, d.thread_id, d.client_id, d.subject, d.to_addresses,
         pg_catalog.cardinality(d.attachment_file_ids), d.updated_at
    from public.mail_drafts d
   order by d.updated_at desc, d.id
   limit 50
$$;
revoke all on function public.list_mail_drafts() from public, anon, authenticated;
grant execute on function public.list_mail_drafts() to authenticated;

-- One draft of the caller with its attachments (name, type, size: the files she may read), or null.
create function public.get_mail_draft(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', d.id, 'connection_id', d.connection_id, 'mode', d.mode, 'thread_id', d.thread_id,
           'reply_to_message_id', d.reply_to_message_id, 'client_id', d.client_id,
           'to', pg_catalog.to_jsonb(d.to_addresses), 'cc', pg_catalog.to_jsonb(d.cc_addresses),
           'bcc', pg_catalog.to_jsonb(d.bcc_addresses), 'subject', d.subject, 'body_html', d.body_html,
           'updated_at', d.updated_at,
           'attachments', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                      'id', f.id, 'name', f.original_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes)
                                      order by pg_catalog.array_position(d.attachment_file_ids, f.id))
                                     from public.stored_files f where f.id = any (d.attachment_file_ids)), '[]'::jsonb))
    from public.mail_drafts d
   where d.id = p_id
$$;
revoke all on function public.get_mail_draft(uuid) from public, anon, authenticated;
grant execute on function public.get_mail_draft(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Templates (communications.inbox)
-- -----------------------------------------------------------------------------
-- The composer's templates: the clinic's (core's catalogue, the clinic's text when it changed it)
-- then the caller's own, by name. `format` says how the body is written: `text` (paragraphs) or
-- `html` (the composer's).
create function public.list_mail_compose_templates()
returns table (kind text, id text, name text, subject text, body text, format text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('communications.inbox') then
    raise exception 'Permission refusée : communications.inbox' using errcode = '42501';
  end if;
  return query
    select x.kind, x.id, x.name, x.subject, x.body, x.format from (
      select 'clinic'::text as kind, d.key as id, d.label as name, coalesce(t.subject, d.subject) as subject,
             coalesce(t.body, d.body) as body, 'text'::text as format, 0 as rank
        from public.email_template_defaults d
        left join public.email_templates t on t.org_id = v_org and t.key = d.key
       where d.module_key = 'communications'
      union all
      select 'personal', m.id::text, m.name, m.subject, m.body_html, 'html', 1
        from public.mail_templates m
       where m.org_id = v_org and m.owner_id = auth.uid()
    ) x
    order by x.rank, pg_catalog.lower(x.name);
end;
$$;
revoke all on function public.list_mail_compose_templates() from public, anon, authenticated;
grant execute on function public.list_mail_compose_templates() to authenticated;

-- « Enregistrer comme modèle » / renamed or rewritten (p_id: one of the caller's); returns its id.
create function public.save_mail_template(p_id uuid, p_name text, p_subject text, p_body_html text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_id uuid;
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_error text := coalesce(private.mail_placeholder_error(p_subject), private.mail_placeholder_error(p_body_html));
begin
  if not private.has_permission('communications.inbox') then
    raise exception 'Permission refusée : communications.inbox' using errcode = '42501';
  end if;
  if pg_catalog.length(v_name) not between 1 and 80 then
    raise exception 'Donnez un nom au modèle (80 caractères au plus).' using errcode = 'P0001', hint = 'name';
  end if;
  if pg_catalog.btrim(coalesce(p_body_html, '')) = '' then
    raise exception 'Le modèle est vide.' using errcode = 'P0001', hint = 'body';
  end if;
  if v_error is not null then
    raise exception '%', v_error using errcode = 'P0001', hint = 'placeholder';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:save_mail_template', true);
  begin
    if p_id is null then
      if (select pg_catalog.count(*) from public.mail_templates m where m.owner_id = auth.uid() and m.org_id = v_org) >= 50 then
        raise exception 'Vous avez déjà 50 modèles.' using errcode = 'P0001', hint = 'templates';
      end if;
      insert into public.mail_templates (org_id, owner_id, name, subject, body_html)
      values (v_org, auth.uid(), v_name, coalesce(p_subject, ''), p_body_html)
      returning id into v_id;
    else
      update public.mail_templates m
         set name = v_name, subject = coalesce(p_subject, ''), body_html = p_body_html
       where m.id = p_id and m.owner_id = auth.uid() and m.org_id = v_org
      returning m.id into v_id;
      if v_id is null then
        raise exception 'Ce modèle n''existe plus.' using errcode = 'P0001', hint = 'template_gone';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'Vous avez déjà un modèle de ce nom.' using errcode = 'P0001', hint = 'name';
    when check_violation then
      raise exception 'Le modèle est trop long ou son objet n''est pas valide.' using errcode = 'P0001', hint = 'body';
  end;
  return v_id;
end;
$$;
revoke all on function public.save_mail_template(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_mail_template(uuid, text, text, text) to authenticated;

create function public.delete_mail_template(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('communications.inbox') then
    raise exception 'Permission refusée : communications.inbox' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:delete_mail_template', true);
  delete from public.mail_templates m
   where m.id = p_id and m.owner_id = auth.uid() and m.org_id = private.current_user_org_id();
end;
$$;
revoke all on function public.delete_mail_template(uuid) from public, anon, authenticated;
grant execute on function public.delete_mail_template(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- From a client record (communications.inbox and clients.view)
-- -----------------------------------------------------------------------------
-- « Écrire un courriel » on a file: its number and name, and the addresses that receive its
-- communications (the person herself, the relations holding the right), from Clients' published
-- `client_contacts_for`. Null for a file the caller cannot see.
create function public.get_mail_compose_context(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_file jsonb;
begin
  if not private.has_permission('communications.inbox') or not private.has_permission('clients.view') then
    raise exception 'Permission refusée : communications.inbox, clients.view' using errcode = '42501';
  end if;
  select pg_catalog.jsonb_build_object('id', c.id, 'client_number', c.client_number, 'display_name', c.display_name)
    into v_file
    from public.clients_directory c
   where c.id = p_client_id and c.org_id = v_org and c.merged_into_id is null and not c.is_anonymized;
  if v_file is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'client', v_file,
    'recipients', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'email', pg_catalog.lower(x.email),
               'name', pg_catalog.btrim(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, '')),
               'is_self', x.is_self, 'relation_type', x.relation_type)
               order by x.is_self desc, x.is_main_contact desc, x.last_name, x.first_name)
        from private.client_contacts_for(v_org, p_client_id, 'communications') x
       where x.email is not null and private.is_mailbox(pg_catalog.lower(x.email))), '[]'::jsonb));
end;
$$;
revoke all on function public.get_mail_compose_context(uuid) from public, anon, authenticated;
grant execute on function public.get_mail_compose_context(uuid) to authenticated;

-- The threads linked to a file (its record's « Courriels »), newest first: the mirror's RLS (the
-- mailboxes the caller reads) and the links' own.
create function public.list_client_mail_threads(p_client_id uuid)
returns table (id uuid, connection_id uuid, subject text, snippet text, last_from_name text, last_from_address text,
               last_message_at timestamptz, message_count int, unread_count int, link_source text)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.connection_id, t.subject, t.snippet, t.last_from_name, t.last_from_address,
         t.last_message_at, t.message_count, t.unread_count, l.source
    from public.mail_thread_links l
    join public.mail_threads t on t.id = l.thread_id
   where l.client_id = p_client_id and l.status = 'linked'
     and (select private.has_permission('clients.view'))
   order by t.last_message_at desc nulls last, t.id
   limit 100
$$;
revoke all on function public.list_client_mail_threads(uuid) from public, anon, authenticated;
grant execute on function public.list_client_mail_threads(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The send (gmail-send, service role)
-- -----------------------------------------------------------------------------
-- Checks one send of p_actor in p_org and records it; see the header. p_send: {send_key,
-- connection_id, mode, thread_id, reply_to_message_id, client_id, draft_id, template_key, to, cc,
-- bcc, subject, body_html, file_ids}. Returns {send_id, already_sent, gmail_message_id,
-- gmail_thread_id, from_name, from_address, in_reply_to, references, values, files}; a refusal is a
-- French P0001 with a HINT (gmail-send passes it on as written).
create function public.prepare_mail_send(p_actor uuid, p_org_id uuid, p_send jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.mail_connections;
  v_key uuid;
  v_mode text;
  v_thread public.mail_threads;
  v_message public.mail_messages;
  v_client uuid;
  v_first text;
  v_last text;
  v_to text[];
  v_cc text[];
  v_bcc text[];
  v_all text[];
  v_files uuid[];
  v_subject text;
  v_body text;
  v_error text;
  v_existing public.mail_sends;
  v_send_id uuid;
  v_total bigint;
  v_found bigint;
  v_external boolean;
  v_values jsonb;
  v_sender text;
  v_clinic text;
begin
  if p_actor is null or p_org_id is null
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active')
     or not ('communications.inbox' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : communications.inbox' using errcode = '42501';
  end if;
  if p_send is null or pg_catalog.jsonb_typeof(p_send) <> 'object' then
    raise exception 'Invalid send' using errcode = '22023';
  end if;
  v_key := (p_send ->> 'send_key')::uuid;
  v_mode := coalesce(p_send ->> 'mode', 'new');
  if v_key is null or v_mode not in ('new', 'reply', 'reply_all', 'forward') then
    raise exception 'Invalid send' using errcode = '22023';
  end if;

  -- The same « Envoyer » again: what happened the first time.
  select s.* into v_existing from public.mail_sends s where s.org_id = p_org_id and s.send_key = v_key for update;
  if v_existing.id is not null then
    if v_existing.sent_by is distinct from p_actor then
      raise exception 'Invalid send' using errcode = '22023';
    end if;
    if v_existing.status = 'sent' then
      return pg_catalog.jsonb_build_object('send_id', v_existing.id, 'already_sent', true,
               'gmail_message_id', v_existing.gmail_message_id, 'gmail_thread_id', v_existing.gmail_thread_id);
    end if;
    if v_existing.status = 'pending' then
      raise exception 'Ce courriel est déjà en cours d''envoi.' using errcode = 'P0001', hint = 'in_progress';
    end if;
  end if;

  v_connection := private.mail_connection_for(p_org_id, p_actor, nullif(p_send ->> 'connection_id', '')::uuid);
  if v_connection.id is null then
    raise exception 'Choisissez une boîte de la clinique.' using errcode = 'P0001', hint = 'connection_id';
  end if;
  if v_connection.status <> 'connected' then
    raise exception 'Cette boîte n''est plus connectée : reconnectez-la dans Paramètres → Courriels Gmail.'
      using errcode = 'P0001', hint = 'needs_reconnect';
  end if;
  if not ('https://www.googleapis.com/auth/gmail.send' = any (v_connection.scopes)) then
    raise exception 'Google n''a pas permis l''envoi depuis cette boîte : reconnectez-la dans Paramètres → Courriels Gmail.'
      using errcode = 'P0001', hint = 'scope_missing';
  end if;

  if nullif(p_send ->> 'thread_id', '') is not null then
    select t.* into v_thread from public.mail_threads t
     where t.id = (p_send ->> 'thread_id')::uuid and t.connection_id = v_connection.id;
    if v_thread.id is null then
      raise exception 'Ce fil n''existe pas.' using errcode = 'P0001', hint = 'thread_id';
    end if;
  end if;
  if v_mode <> 'new' and v_thread.id is null then
    raise exception 'Une réponse ou un transfert part d''un fil.' using errcode = 'P0001', hint = 'thread_id';
  end if;
  if nullif(p_send ->> 'reply_to_message_id', '') is not null then
    select m.* into v_message from public.mail_messages m
     where m.id = (p_send ->> 'reply_to_message_id')::uuid and m.thread_id = v_thread.id;
    if v_message.id is null then
      raise exception 'Ce message n''existe pas.' using errcode = 'P0001', hint = 'reply_to_message_id';
    end if;
  end if;

  -- Recipients.
  select coalesce(pg_catalog.array_agg(distinct pg_catalog.lower(pg_catalog.btrim(x))), '{}') into v_to
    from pg_catalog.jsonb_array_elements_text(coalesce(p_send -> 'to', '[]')) x where pg_catalog.btrim(x) <> '';
  select coalesce(pg_catalog.array_agg(distinct pg_catalog.lower(pg_catalog.btrim(x))), '{}') into v_cc
    from pg_catalog.jsonb_array_elements_text(coalesce(p_send -> 'cc', '[]')) x where pg_catalog.btrim(x) <> '';
  select coalesce(pg_catalog.array_agg(distinct pg_catalog.lower(pg_catalog.btrim(x))), '{}') into v_bcc
    from pg_catalog.jsonb_array_elements_text(coalesce(p_send -> 'bcc', '[]')) x where pg_catalog.btrim(x) <> '';
  if pg_catalog.cardinality(v_to) = 0 then
    raise exception 'Ajoutez au moins un destinataire.' using errcode = 'P0001', hint = 'to';
  end if;
  if not (private.mail_addresses_valid(v_to, 50) and private.mail_addresses_valid(v_cc, 50)
          and private.mail_addresses_valid(v_bcc, 50)) then
    raise exception 'Une adresse n''est pas valide.' using errcode = 'P0001', hint = 'to';
  end if;
  v_all := v_to || v_cc || v_bcc;

  v_subject := pg_catalog.btrim(coalesce(p_send ->> 'subject', ''));
  v_body := coalesce(p_send ->> 'body_html', '');
  if v_subject = '' then
    raise exception 'Ajoutez un objet.' using errcode = 'P0001', hint = 'subject';
  end if;
  if pg_catalog.length(v_subject) > 250 or v_subject ~ '[\r\n]' then
    raise exception 'L''objet est trop long.' using errcode = 'P0001', hint = 'subject';
  end if;
  if pg_catalog.btrim(pg_catalog.regexp_replace(v_body, '<[^>]*>|&nbsp;', '', 'g')) = '' and v_mode <> 'forward' then
    raise exception 'Le message est vide.' using errcode = 'P0001', hint = 'body';
  end if;
  if pg_catalog.octet_length(v_body) > 524288 then
    raise exception 'Le message est trop long.' using errcode = 'P0001', hint = 'body';
  end if;

  -- The file it is about: named, else the thread's link (only while Clients is on).
  v_client := nullif(p_send ->> 'client_id', '')::uuid;
  if v_client is null and v_thread.id is not null then
    select l.client_id into v_client from public.mail_thread_links l where l.thread_id = v_thread.id and l.status = 'linked';
  end if;
  if v_client is not null then
    if not public.module_enabled_for_org(p_org_id, 'clients') then
      v_client := null;
    else
      select x.first_name, x.last_name into v_first, v_last
        from private.client_contacts_for(p_org_id, v_client, 'communications') x where x.is_self;
      if not found then
        raise exception 'Ce dossier client n''existe pas.' using errcode = 'P0001', hint = 'client_id';
      end if;
    end if;
  end if;

  -- P3-40: a module « Réservé aux testeurs » writes to nobody outside the clinic.
  select exists (
    select 1 from pg_catalog.unnest(v_all) a
     where not exists (select 1 from public.profiles p
                        where p.org_id = p_org_id and p.status = 'active' and pg_catalog.lower(p.email) = a)
       and not exists (select 1 from public.mail_connections c where c.org_id = p_org_id and c.email_address = a))
    into v_external;
  if v_external and (private.module_sends_held(p_org_id, 'communications')
                     or (v_client is not null and private.module_sends_held(p_org_id, 'clients'))) then
    raise exception 'Le module est réservé aux testeurs : un courriel à une personne hors de la clinique ne peut pas encore partir.'
      using errcode = 'P0001', hint = 'module_reserved';
  end if;

  -- Placeholders (CM-15).
  v_error := coalesce(private.mail_placeholder_error(v_subject), private.mail_placeholder_error(v_body));
  if v_error is not null then
    raise exception '%', v_error using errcode = 'P0001', hint = 'placeholder';
  end if;
  if (v_subject || v_body) ~ '\{\{\s*person\.' and v_client is null then
    raise exception 'Le prénom de la personne n''est pas connu : rattachez le courriel à un dossier ou retirez {{person.first_name}}.'
      using errcode = 'P0001', hint = 'placeholder';
  end if;
  select p.display_name into v_sender from public.profiles p where p.user_id = p_actor;
  select o.name into v_clinic from public.organizations o where o.id = p_org_id;
  v_values := pg_catalog.jsonb_build_object(
    'clinic.name', v_clinic,
    'sender.name', coalesce(nullif(pg_catalog.btrim(v_sender), ''), v_clinic),
    'person.first_name', case when v_client is not null then coalesce(v_first, '') end,
    'person.last_name', case when v_client is not null then coalesce(v_last, '') end);

  -- Files (CM-16).
  select coalesce(pg_catalog.array_agg(distinct x::uuid), '{}') into v_files
    from pg_catalog.jsonb_array_elements_text(coalesce(p_send -> 'file_ids', '[]')) x;
  if pg_catalog.cardinality(v_files) > 10 then
    raise exception 'Dix pièces jointes au plus.' using errcode = 'P0001', hint = 'file_ids';
  end if;
  select pg_catalog.count(*), coalesce(pg_catalog.sum(f.size_bytes), 0) into v_found, v_total
    from private.mail_files_for(p_org_id, p_actor, v_files) f;
  if v_found <> pg_catalog.cardinality(v_files) then
    raise exception 'Une pièce jointe est introuvable.' using errcode = 'P0001', hint = 'file_ids';
  end if;
  if v_total > 18 * 1024 * 1024 then
    raise exception 'Les pièces jointes dépassent 18 Mo : Gmail refuserait le courriel.' using errcode = 'P0001', hint = 'file_ids';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'fn:gmail-send', true);
  if v_existing.id is not null then
    update public.mail_sends s
       set status = 'pending', error_code = null, connection_id = v_connection.id, mode = v_mode,
           thread_id = v_thread.id, client_id = v_client, draft_id = nullif(p_send ->> 'draft_id', '')::uuid,
           template_key = nullif(pg_catalog.left(p_send ->> 'template_key', 100), ''),
           recipient_count = pg_catalog.cardinality(v_all), file_ids = v_files
     where s.id = v_existing.id;
    v_send_id := v_existing.id;
  else
    insert into public.mail_sends (org_id, connection_id, sent_by, send_key, mode, thread_id, client_id, draft_id,
                                   template_key, recipient_count, file_ids)
    values (p_org_id, v_connection.id, p_actor, v_key, v_mode, v_thread.id, v_client,
            nullif(p_send ->> 'draft_id', '')::uuid, nullif(pg_catalog.left(p_send ->> 'template_key', 100), ''),
            pg_catalog.cardinality(v_all), v_files)
    returning id into v_send_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'send_id', v_send_id,
    'already_sent', false,
    'from_name', v_clinic,
    'from_address', v_connection.email_address,
    'to', pg_catalog.to_jsonb(v_to), 'cc', pg_catalog.to_jsonb(v_cc), 'bcc', pg_catalog.to_jsonb(v_bcc),
    'subject', v_subject,
    -- A forward starts a new thread in Gmail; a reply stays in its thread.
    'gmail_thread_id', case when v_mode in ('reply', 'reply_all') then v_thread.gmail_thread_id end,
    'in_reply_to', case when v_mode in ('reply', 'reply_all') then v_message.rfc_message_id end,
    'references', case when v_mode in ('reply', 'reply_all') then (
        select pg_catalog.string_agg(r.rfc_message_id, ' ' order by r.sent_at, r.id)
          from (select m.rfc_message_id, m.sent_at, m.id from public.mail_messages m
                 where m.thread_id = v_thread.id and m.rfc_message_id is not null
                   and (v_message.id is null or m.sent_at <= v_message.sent_at)
                 order by m.sent_at desc, m.id desc limit 20) r) end,
    'values', v_values,
    'files', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                         'id', f.id, 'bucket', f.bucket, 'object_path', f.object_path, 'name', f.original_name,
                         'mime_type', f.mime_type, 'size_bytes', f.size_bytes)
                         order by pg_catalog.array_position(v_files, f.id))
                        from private.mail_files_for(p_org_id, p_actor, v_files) f), '[]'::jsonb));
end;
$$;
revoke all on function public.prepare_mail_send(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.prepare_mail_send(uuid, uuid, jsonb) to service_role;

-- Closes the send p_send_id once Gmail answered: `sent` with Gmail's ids (after the message was
-- mirrored) or `failed` with a code. Sent: the draft goes, the composer's uploads are kept with
-- the send (no expiry), and the thread is linked to the file when it was not linked yet. Returns
-- the mirror's thread id (null when the message is not mirrored yet, or failed).
create function public.complete_mail_send(
  p_org_id uuid,
  p_send_id uuid,
  p_status text,
  p_gmail_message_id text default null,
  p_gmail_thread_id text default null,
  p_error_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.mail_sends;
  v_thread uuid;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  select s.* into v from public.mail_sends s where s.id = p_send_id and s.org_id = p_org_id for update;
  if v.id is null or v.status <> 'pending' then
    raise exception 'Send not pending' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'fn:gmail-send', true);
  if p_status = 'failed' then
    update public.mail_sends s set status = 'failed', error_code = coalesce(p_error_code, 'failed') where s.id = v.id;
    return null;
  end if;
  if p_gmail_message_id is null or p_gmail_message_id !~ '^[A-Za-z0-9_-]{1,64}$'
     or (p_gmail_thread_id is not null and p_gmail_thread_id !~ '^[A-Za-z0-9_-]{1,64}$') then
    raise exception 'Invalid Gmail ids' using errcode = '22023';
  end if;
  select t.id into v_thread from public.mail_threads t
   where t.connection_id = v.connection_id and t.gmail_thread_id = p_gmail_thread_id;
  update public.mail_sends s
     set status = 'sent', error_code = null, gmail_message_id = p_gmail_message_id, gmail_thread_id = p_gmail_thread_id,
         sent_at = pg_catalog.now(), thread_id = coalesce(v_thread, s.thread_id)
   where s.id = v.id;
  if v.draft_id is not null then
    delete from public.mail_drafts d where d.id = v.draft_id and d.user_id = v.sent_by and d.org_id = p_org_id;
  end if;
  -- The composer's uploads stay with the send (CM-16).
  update public.stored_files f
     set subject_type = 'mail_send', subject_id = v.id, retain_until = null
   where f.org_id = p_org_id and f.id = any (v.file_ids) and f.purpose = 'mail_outgoing' and f.status = 'ready';
  -- The new thread belongs to the file the message was about (a person's choice: manual).
  if v_thread is not null and v.client_id is not null then
    insert into public.mail_thread_links as l (thread_id, org_id, status, client_id, candidate_client_ids, source, linked_by, linked_at)
    values (v_thread, p_org_id, 'linked', v.client_id, '{}', 'manual', v.sent_by, pg_catalog.now())
    on conflict (thread_id) do update
      set status = 'linked', client_id = excluded.client_id, candidate_client_ids = '{}', source = 'manual',
          linked_by = excluded.linked_by, linked_at = excluded.linked_at
      where l.status <> 'linked';
  end if;
  return v_thread;
end;
$$;
revoke all on function public.complete_mail_send(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_mail_send(uuid, uuid, text, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Clients' merge and anonymisation: the drafts and the sends follow too (CM2b's handlers replaced)
-- -----------------------------------------------------------------------------
create or replace function private.communications_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
  v_more int;
begin
  update public.mail_thread_links l
     set client_id = case when l.client_id = p_old then p_new else l.client_id end,
         candidate_client_ids = (select coalesce(array_agg(distinct case when x = p_old then p_new else x end), '{}')
                                   from pg_catalog.unnest(l.candidate_client_ids) x)
   where l.client_id = p_old or p_old = any (l.candidate_client_ids);
  get diagnostics v_count = row_count;
  update public.mail_drafts d set client_id = p_new where d.client_id = p_old;
  get diagnostics v_more = row_count;
  v_count := v_count + v_more;
  update public.mail_sends s set client_id = p_new where s.client_id = p_old;
  get diagnostics v_more = row_count;
  return v_count + v_more;
end;
$$;

create or replace function private.communications_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
  v_more int;
begin
  update public.mail_thread_links l
     set status = case when l.client_id = p_id then 'unlinked' else l.status end,
         client_id = case when l.client_id = p_id then null else l.client_id end,
         candidate_client_ids = pg_catalog.array_remove(l.candidate_client_ids, p_id)
   where l.client_id = p_id or p_id = any (l.candidate_client_ids);
  get diagnostics v_count = row_count;
  update public.mail_drafts d set client_id = null where d.client_id = p_id;
  get diagnostics v_more = row_count;
  v_count := v_count + v_more;
  update public.mail_sends s set client_id = null where s.client_id = p_id;
  get diagnostics v_more = row_count;
  return v_count + v_more;
end;
$$;

-- -----------------------------------------------------------------------------
-- The backfill of CM2b's automatic link (CM-17)
-- -----------------------------------------------------------------------------
-- Every clinic with Communications and Clients on: its threads with inbound mail that no person
-- linked or unlinked and that are not linked yet go to `communications_link_threads`, 500 at a
-- time in id order (each thread once per run). A person's decision is never changed: the helper
-- skips manual and linked rows. Idempotent: a second run re-evaluates only what is still open.
create function private.job_mail_links_backfill()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_ids uuid[];
  v_after uuid;
  v_seen bigint := 0;
  v_linked_before bigint;
  v_linked_after bigint;
begin
  select pg_catalog.count(*) into v_linked_before from public.mail_thread_links l where l.status = 'linked';
  for v_org in
    select o.id from public.organizations o
     where public.module_enabled_for_org(o.id, 'communications') and public.module_enabled_for_org(o.id, 'clients')
     order by o.id
  loop
    v_after := null;
    loop
      select pg_catalog.array_agg(x.id order by x.id) into v_ids
        from (select t.id from public.mail_threads t
                left join public.mail_thread_links l on l.thread_id = t.id
               where t.org_id = v_org
                 and (v_after is null or t.id > v_after)
                 and (l.thread_id is null or (l.source is distinct from 'manual' and l.status <> 'linked'))
                 and exists (select 1 from public.mail_messages m where m.thread_id = t.id and m.is_inbound)
               order by t.id
               limit 500) x;
      exit when v_ids is null;
      perform private.communications_link_threads(v_org, v_ids);
      v_seen := v_seen + pg_catalog.cardinality(v_ids);
      v_after := v_ids[pg_catalog.cardinality(v_ids)];
      exit when pg_catalog.cardinality(v_ids) < 500;
    end loop;
  end loop;
  select pg_catalog.count(*) into v_linked_after from public.mail_thread_links l where l.status = 'linked';
  return 'threads=' || v_seen || ' linked=' || (v_linked_after - v_linked_before);
end;
$$;
revoke all on function private.job_mail_links_backfill() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('communications.mail_links_backfill', 'communications', 'Rattachement des anciens courriels',
   'Rattache aux dossiers clients les fils qui n''ont pas encore de dossier (par l''adresse de l''expéditeur), y compris ceux reçus avant la création du dossier. Ne touche jamais un rattachement fait ou défait par une personne. Chaque nuit.',
   'sql', null, 'private.job_mail_links_backfill', 'communications.mail_links_backfill', null, true)
on conflict do nothing;

select cron.schedule('communications.mail_links_backfill', '25 8 * * *',
  $$select private.run_sql_job('communications.mail_links_backfill')$$);
