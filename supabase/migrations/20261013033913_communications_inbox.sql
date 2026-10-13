-- =============================================================================
-- Module Communications, batch CM2: « Courriels », the inbox
-- =============================================================================
-- What the inbox reads and the service RPC its actions need. The mirror itself (threads, messages,
-- attachments, labels) is CM1's (*_communications_gmail.sql); nothing here writes it except
-- through CM1's `apply_mail_label_changes`.
--
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §11 (CM2)
-- Decisions: CM-11 … (docs/plans/2026-10-07-decisions-log.md)
--
-- * `list_mail_threads` and `get_mail_thread` are SECURITY INVOKER: the caller's RLS on the mirror
--   (`private.visible_mail_connection_ids`, which holds the module gate and the permission) is the
--   whole check. Nothing is returned for a mailbox the caller cannot see.
-- * The list is keyset-paginated on (last_message_at, id), newest first; the search reads the
--   messages' French `search_vector` (subject, sender, snippet: never the body, CM1) with
--   `websearch_to_tsquery`, so « facture -interac » and "phrases" work as in Gmail.
-- * The actions (read, unread, archive, back to the inbox, star, a user label) go through the
--   `gmail-modify` function: Gmail first, then the mirror (`apply_mail_label_changes`), so the
--   app never shows a state Gmail refused. `get_mail_threads_for_action` (service role) re-checks
--   the actor, as conventions §8b ask: an active member holding communications.inbox, the mailbox
--   connected and visible to her.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:communications_inbox', true);

-- -----------------------------------------------------------------------------
-- The thread list of one mailbox, one view at a time
-- -----------------------------------------------------------------------------
-- p_view: `inbox` (INBOX), `unread` (INBOX with an unread message), `starred`, `sent`, `all`
-- (everything but TRASH and SPAM), `label` (p_label_id). p_search narrows any view. Keyset:
-- the rows strictly after (p_before, p_before_id). At most 100 rows (default 50).
create function public.list_mail_threads(
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
revoke all on function public.list_mail_threads(uuid, text, text, text, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function public.list_mail_threads(uuid, text, text, text, timestamptz, uuid, int) to authenticated;

-- -----------------------------------------------------------------------------
-- One thread: its summary, its messages (oldest first, the latest 100) and their attachments
-- -----------------------------------------------------------------------------
-- Null when the thread does not exist or the caller cannot see it.
create function public.get_mail_thread(p_thread_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'id', t.id,
           'connection_id', t.connection_id,
           'mailbox', c.email_address,
           'gmail_thread_id', t.gmail_thread_id,
           'subject', t.subject,
           'label_ids', to_jsonb(t.label_ids),
           'message_count', t.message_count,
           'unread_count', t.unread_count,
           'link_status', coalesce(l.status, 'unlinked'),
           'messages', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', m.id,
                      'gmail_message_id', m.gmail_message_id,
                      'from_name', m.from_name,
                      'from_address', m.from_address,
                      'to', m.to_addresses,
                      'cc', m.cc_addresses,
                      'reply_to_address', m.reply_to_address,
                      'subject', m.subject,
                      'snippet', m.snippet,
                      'sent_at', m.sent_at,
                      'label_ids', to_jsonb(m.label_ids),
                      'is_unread', m.is_unread,
                      'is_inbound', m.is_inbound,
                      'body_html', m.body_html,
                      'body_text', m.body_text,
                      'body_purged', m.body_purged_at is not null,
                      'attachments', coalesce((
                        select jsonb_agg(jsonb_build_object(
                                 'id', a.id,
                                 'filename', a.filename,
                                 'mime_type', a.mime_type,
                                 'size_bytes', a.size_bytes,
                                 'content_id', a.content_id,
                                 'is_inline', a.is_inline,
                                 'status', a.status,
                                 'stored_file_id', a.stored_file_id) order by a.part_id)
                          from public.mail_attachments a where a.message_id = m.id), '[]'::jsonb))
                    order by m.sent_at, m.id)
               from (select * from public.mail_messages x where x.thread_id = t.id
                      order by x.sent_at desc, x.id desc limit 100) m), '[]'::jsonb))
    from public.mail_threads t
    join public.mail_connections c on c.id = t.connection_id
    left join public.mail_thread_links l on l.thread_id = t.id
   where t.id = p_thread_id
$$;
revoke all on function public.get_mail_thread(uuid) from public, anon, authenticated;
grant execute on function public.get_mail_thread(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The threads an action targets (gmail-modify; service role)
-- -----------------------------------------------------------------------------
-- p_actor's standing is re-checked (conventions §8b): an active member of p_org holding
-- communications.inbox; only threads of p_org's connected mailboxes she may read (shared, or her
-- own personal one) are returned, at most 50, with what Gmail needs: the thread's and messages'
-- Gmail ids and the messages' labels (the function computes the mirror's changes from them).
create function public.get_mail_threads_for_action(p_actor uuid, p_org_id uuid, p_thread_ids uuid[])
returns table (
  thread_id uuid, connection_id uuid, gmail_thread_id text, messages jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is null or p_org_id is null
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active')
     or not ('communications.inbox' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : communications.inbox' using errcode = '42501';
  end if;
  if p_thread_ids is null or pg_catalog.cardinality(p_thread_ids) not between 1 and 50 then
    raise exception 'Between 1 and 50 threads' using errcode = '22023';
  end if;
  return query
  select t.id, t.connection_id, t.gmail_thread_id,
         coalesce((select jsonb_agg(jsonb_build_object('gmail_message_id', m.gmail_message_id,
                                                        'label_ids', to_jsonb(m.label_ids))
                                    order by m.sent_at, m.id)
                     from public.mail_messages m where m.thread_id = t.id), '[]'::jsonb)
    from public.mail_threads t
    join public.mail_connections c on c.id = t.connection_id
   where t.org_id = p_org_id and t.id = any (p_thread_ids)
     and c.status = 'connected'
     and (c.kind = 'shared' or c.owner_profile_id = p_actor)
   order by t.id;
end;
$$;
revoke all on function public.get_mail_threads_for_action(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.get_mail_threads_for_action(uuid, uuid, uuid[]) to service_role;

-- -----------------------------------------------------------------------------
-- The mail itself is read with communications.inbox only (CM-11)
-- -----------------------------------------------------------------------------
-- CM1's `visible_mail_connection_ids` also lets communications.mailboxes_manage through, so a role
-- that manages the connections without reading the inbox could read every body. The mailboxes
-- (`mail_connections`) stay visible to both; their content (labels, threads, messages,
-- attachments, links) now needs the inbox permission.
create function private.readable_mail_connection_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}'::uuid[])
    from public.mail_connections c
   where c.org_id = private.current_user_org_id()
     and private.has_permission('communications.inbox')
     and (c.kind = 'shared' or c.owner_profile_id = auth.uid())
$$;
revoke all on function private.readable_mail_connection_ids() from public, anon;
grant execute on function private.readable_mail_connection_ids() to authenticated, service_role;

drop policy mail_labels_select on public.mail_labels;
create policy mail_labels_select on public.mail_labels
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and connection_id = any ((select private.readable_mail_connection_ids())::uuid[])
  );
drop policy mail_threads_select on public.mail_threads;
create policy mail_threads_select on public.mail_threads
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and connection_id = any ((select private.readable_mail_connection_ids())::uuid[])
  );
drop policy mail_messages_select on public.mail_messages;
create policy mail_messages_select on public.mail_messages
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and connection_id = any ((select private.readable_mail_connection_ids())::uuid[])
  );
drop policy mail_attachments_select on public.mail_attachments;
create policy mail_attachments_select on public.mail_attachments
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and exists (select 1 from public.mail_messages m
                 where m.id = mail_attachments.message_id
                   and m.connection_id = any ((select private.readable_mail_connection_ids())::uuid[]))
  );
drop policy mail_thread_links_select on public.mail_thread_links;
create policy mail_thread_links_select on public.mail_thread_links
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and exists (select 1 from public.mail_threads t
                 where t.id = mail_thread_links.thread_id
                   and t.connection_id = any ((select private.readable_mail_connection_ids())::uuid[]))
  );
