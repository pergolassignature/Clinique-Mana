-- =============================================================================
-- Module Communications, batch CM2b: a mail thread linked to its client
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §11 (CM2b); design: CM-12 and
--            docs/modules/communications.md « The thread → client link »
-- Decisions: CM-13 (this batch)
-- Needs:     CM1's `mail_thread_links`; Clients' published `private.clients_match_email`,
--            `clients_directory`, `client_merge_handlers` / `client_anonymize_handlers`.
--
-- * Automatic: a statement trigger after the sync inserts messages hands each thread with a new
--   inbound message to `private.communications_link_threads`: its senders' addresses (never the
--   mailbox's own) go to Clients' `clients_match_email`; the files whose own address it is win
--   over a related person's; one → `linked` (source `auto`), several → `needs_review` (« À
--   rattacher », ≤ 20 candidates), none → `unlinked`. Only while Clients is enabled. A link a person
--   made or undid (source `manual`) is never touched again, nor an automatic one already linked.
-- * Manual (`communications.inbox` and `clients.view`): `link_mail_thread`, `unlink_mail_thread`.
-- * Read: `get_mail_thread_link` (invoker: the mirror's RLS and Clients' own); « À rattacher » is
--   the view `to_link` of `list_mail_threads` (replaced, same signature).
-- * A merge of clients re-points the links, an anonymisation removes them (Clients' handler
--   catalogues: data, ADR 0003).
-- Additive: functions, one trigger, catalogue rows; `list_mail_threads` replaced (same signature).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:communications_client_links', true);

-- -----------------------------------------------------------------------------
-- The automatic link
-- -----------------------------------------------------------------------------
-- Links p_org's threads p_thread_ids (those without a link, or still unlinked / to review, never a
-- manual one) from their inbound senders. Returns how many threads were (re)evaluated.
create function private.communications_link_threads(p_org uuid, p_thread_ids uuid[])
returns int
language plpgsql
set search_path = ''
as $$
declare
  t record;
  v_candidates uuid[];
  v_count int := 0;
begin
  if p_thread_ids is null or pg_catalog.cardinality(p_thread_ids) = 0 or not public.module_enabled_for_org(p_org, 'clients') then
    return 0;
  end if;
  for t in
    select th.id, (select coalesce(array_agg(distinct pg_catalog.lower(m.from_address)), '{}')
                     from public.mail_messages m
                     join public.mail_connections c on c.id = m.connection_id
                    where m.thread_id = th.id and m.is_inbound and m.from_address is not null
                      and pg_catalog.lower(m.from_address) <> pg_catalog.lower(c.email_address)) as senders
      from public.mail_threads th
      left join public.mail_thread_links l on l.thread_id = th.id
     where th.org_id = p_org and th.id = any (p_thread_ids)
       and (l.thread_id is null or (l.source is distinct from 'manual' and l.status <> 'linked'))
  loop
    if pg_catalog.cardinality(t.senders) = 0 then
      continue;
    end if;
    -- The files whose own address it is; else the people related to them.
    select coalesce((select array_agg(distinct x.client_id) from private.clients_match_email(p_org, t.senders) x where x.match_kind = 'client'),
                    (select array_agg(distinct x.client_id) from private.clients_match_email(p_org, t.senders) x where x.match_kind = 'relation'),
                    '{}')
      into v_candidates;
    insert into public.mail_thread_links as l (thread_id, org_id, status, client_id, candidate_client_ids, source, linked_at)
    values (t.id, p_org,
            case pg_catalog.cardinality(v_candidates) when 0 then 'unlinked' when 1 then 'linked' else 'needs_review' end,
            case when pg_catalog.cardinality(v_candidates) = 1 then v_candidates[1] end,
            case when pg_catalog.cardinality(v_candidates) > 1 then v_candidates[1:20] else '{}' end,
            case when pg_catalog.cardinality(v_candidates) > 0 then 'auto' end,
            case when pg_catalog.cardinality(v_candidates) = 1 then pg_catalog.now() end)
    on conflict (thread_id) do update
      set status = excluded.status, client_id = excluded.client_id, candidate_client_ids = excluded.candidate_client_ids,
          source = excluded.source, linked_at = excluded.linked_at
      where l.source is distinct from 'manual' and l.status <> 'linked';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.communications_link_threads(uuid, uuid[]) from public, anon, authenticated, service_role;

-- After the sync inserts messages: each org's threads with a new inbound message are linked.
create function private.communications_link_new_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  for r in select n.org_id, array_agg(distinct n.thread_id) as threads from new_messages n where n.is_inbound group by n.org_id loop
    perform pg_catalog.set_config('app.audit_source', 'sync:communications_link_threads', true);
    perform private.communications_link_threads(r.org_id, r.threads);
  end loop;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return null;
end;
$$;
revoke all on function private.communications_link_new_messages() from public, anon, authenticated, service_role;

create trigger mail_messages_link_clients after insert on public.mail_messages
  referencing new table as new_messages
  for each statement execute function private.communications_link_new_messages();

-- -----------------------------------------------------------------------------
-- Manual link (communications.inbox and clients.view)
-- -----------------------------------------------------------------------------
-- The thread p_thread_id, visible to the caller and of her clinic; P0001 otherwise.
create function private.communications_visible_thread(p_thread_id uuid)
returns public.mail_threads
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.mail_threads;
begin
  select t.* into v from public.mail_threads t
   where t.id = p_thread_id and t.org_id = private.current_user_org_id()
     and t.connection_id = any (private.readable_mail_connection_ids());
  if v.id is null then
    raise exception 'Ce fil n''existe pas.' using errcode = 'P0001';
  end if;
  return v;
end;
$$;
revoke all on function private.communications_visible_thread(uuid) from public, anon, authenticated, service_role;

create function public.link_mail_thread(p_thread_id uuid, p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.mail_threads;
begin
  if not private.has_permission('communications.inbox') or not private.has_permission('clients.view') then
    raise exception 'Permission refusée : communications.inbox, clients.view' using errcode = '42501';
  end if;
  v := private.communications_visible_thread(p_thread_id);
  if p_client_id is null or not exists (
       select 1 from public.clients_directory c
        where c.id = p_client_id and c.org_id = v.org_id and c.merged_into_id is null and not c.is_anonymized) then
    raise exception 'Choisissez un dossier client de la clinique.' using errcode = 'P0001', hint = 'client_id';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:link_mail_thread', true);
  insert into public.mail_thread_links as l (thread_id, org_id, status, client_id, candidate_client_ids, source, linked_by, linked_at)
  values (v.id, v.org_id, 'linked', p_client_id, '{}', 'manual', auth.uid(), pg_catalog.now())
  on conflict (thread_id) do update
    set status = 'linked', client_id = p_client_id, candidate_client_ids = '{}', source = 'manual',
        linked_by = auth.uid(), linked_at = pg_catalog.now();
end;
$$;
revoke all on function public.link_mail_thread(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_mail_thread(uuid, uuid) to authenticated;

-- « Détacher »: the thread is unlinked by a person, so the sync never links it again.
create function public.unlink_mail_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.mail_threads;
begin
  if not private.has_permission('communications.inbox') or not private.has_permission('clients.view') then
    raise exception 'Permission refusée : communications.inbox, clients.view' using errcode = '42501';
  end if;
  v := private.communications_visible_thread(p_thread_id);
  perform pg_catalog.set_config('app.audit_source', 'rpc:unlink_mail_thread', true);
  insert into public.mail_thread_links as l (thread_id, org_id, status, source, linked_by, linked_at)
  values (v.id, v.org_id, 'unlinked', 'manual', auth.uid(), pg_catalog.now())
  on conflict (thread_id) do update
    set status = 'unlinked', client_id = null, candidate_client_ids = '{}', source = 'manual',
        linked_by = auth.uid(), linked_at = pg_catalog.now();
end;
$$;
revoke all on function public.unlink_mail_thread(uuid) from public, anon, authenticated;
grant execute on function public.unlink_mail_thread(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Read
-- -----------------------------------------------------------------------------
-- The thread's link: its status and source, the file (number, name) and, to review, the candidates.
-- Invoker: the mirror's RLS (the thread visible) and Clients' (the files, clients.view). Null for a
-- thread the caller cannot see.
create function public.get_mail_thread_link(p_thread_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'status', coalesce(l.status, 'unlinked'),
           'source', l.source,
           'client', (select pg_catalog.jsonb_build_object('id', c.id, 'client_number', c.client_number, 'display_name', c.display_name)
                        from public.clients_directory c where c.id = l.client_id),
           'candidates', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                     'id', c.id, 'client_number', c.client_number, 'display_name', c.display_name)
                                     order by c.client_number)
                                     from public.clients_directory c where c.id = any (l.candidate_client_ids)), '[]'::jsonb))
    from public.mail_threads t
    left join public.mail_thread_links l on l.thread_id = t.id
   where t.id = p_thread_id
$$;
revoke all on function public.get_mail_thread_link(uuid) from public, anon, authenticated;
grant execute on function public.get_mail_thread_link(uuid) to authenticated;

-- The thread list, now with « À rattacher » (`to_link`: in the inbox, to review or never linked,
-- never one a person unlinked). Otherwise as CM2.
create or replace function public.list_mail_threads(
  p_connection_id uuid,
  p_view text default 'inbox',
  p_label_id text default null,
  p_search text default null,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 50
)
returns table (
  id uuid, connection_id uuid, gmail_thread_id text, subject text, snippet text,
  last_from_name text, last_from_address text, last_message_at timestamptz,
  message_count int, unread_count int, has_attachments boolean, label_ids text[], link_status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.connection_id, t.gmail_thread_id, t.subject, t.snippet,
         t.last_from_name, t.last_from_address, t.last_message_at,
         t.message_count, t.unread_count, t.has_attachments, t.label_ids,
         coalesce(l.status, 'unlinked')
    from public.mail_threads t
    left join public.mail_thread_links l on l.thread_id = t.id
   where t.connection_id = p_connection_id
     and case p_view
           when 'inbox' then 'INBOX' = any (t.label_ids)
           when 'unread' then 'INBOX' = any (t.label_ids) and t.unread_count > 0
           when 'starred' then 'STARRED' = any (t.label_ids)
           when 'sent' then 'SENT' = any (t.label_ids)
           when 'all' then not (t.label_ids && array['TRASH', 'SPAM'])
           when 'label' then p_label_id is not null and p_label_id = any (t.label_ids)
           when 'to_link' then 'INBOX' = any (t.label_ids) and coalesce(l.status, 'unlinked') <> 'linked'
                               and l.source is distinct from 'manual'
           else false
         end
     and (nullif(pg_catalog.btrim(p_search), '') is null
          or exists (select 1 from public.mail_messages m
                      where m.thread_id = t.id
                        and m.search_vector @@ pg_catalog.websearch_to_tsquery('french', pg_catalog.left(p_search, 200))))
     and (p_before is null or (t.last_message_at, t.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by t.last_message_at desc, t.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- -----------------------------------------------------------------------------
-- Clients' merge and anonymisation (their handler catalogues)
-- -----------------------------------------------------------------------------
-- A merge: the links and the candidates follow the kept file.
create function private.communications_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.mail_thread_links l
     set client_id = case when l.client_id = p_old then p_new else l.client_id end,
         candidate_client_ids = (select coalesce(array_agg(distinct case when x = p_old then p_new else x end), '{}')
                                   from pg_catalog.unnest(l.candidate_client_ids) x)
   where l.client_id = p_old or p_old = any (l.candidate_client_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.communications_reassign_client(uuid, uuid) from public, anon, authenticated, service_role;

-- An anonymisation: her threads are no longer linked to her (the mail stays Gmail's), nor offered.
create function private.communications_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.mail_thread_links l
     set status = case when l.client_id = p_id then 'unlinked' else l.status end,
         client_id = case when l.client_id = p_id then null else l.client_id end,
         candidate_client_ids = pg_catalog.array_remove(l.candidate_client_ids, p_id)
   where l.client_id = p_id or p_id = any (l.candidate_client_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.communications_anonymize_client(uuid) from public, anon, authenticated, service_role;

insert into public.client_merge_handlers (module_key, function_name)
values ('communications', 'private.communications_reassign_client')
on conflict do nothing;
insert into public.client_anonymize_handlers (module_key, function_name)
values ('communications', 'private.communications_anonymize_client')
on conflict do nothing;
