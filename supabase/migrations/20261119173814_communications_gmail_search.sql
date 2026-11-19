-- =============================================================================
-- Communications: « Dans Gmail », the search beyond the mirror (CM-30)
-- =============================================================================
-- « Courriels »' search finds only the mirror (from 45 days before the connection, CM-7) by
-- subject, sender and snippet. `gmail-search` asks Gmail itself, within the mirror's 24 months
-- (CM-8), and shows the threads the mirror does not hold without storing them; opening one copies
-- that thread into the mirror (`mirrorMessage`, as `gmail-send` does), after which it is an
-- ordinary thread. Design: docs/plans/2026-11-19-communications-gmail-search.md.
-- Needs:   *_communications_gmail.sql (the mirror), *_communications_inbox.sql (the actor model of
--          `get_mail_threads_for_action`).
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6.
--
-- Key choices
-- * **One service RPC, the actor re-checked (conventions §8b).** The function calls it before it
--   reads the mailbox's token, and again after an open: the caller must be an active member
--   holding `communications.inbox`, and the mailbox connected and readable by them (a shared
--   mailbox, or their own), as for the inbox's actions. It answers which of the given Gmail threads
--   the mirror holds, and their ids.
-- * **Nothing new is stored.** No table, no column: a search writes nothing, and an open goes
--   through `upsert_mail_messages` like the sync.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:communications_gmail_search', true);

create function public.get_mail_search_threads_for_service(p_actor uuid, p_org_id uuid, p_connection_id uuid,
                                                           p_gmail_thread_ids text[])
returns table (gmail_thread_id text, thread_id uuid)
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
  if not exists (select 1 from public.mail_connections c
                  where c.id = p_connection_id and c.org_id = p_org_id and c.status = 'connected'
                    and (c.kind = 'shared' or c.owner_profile_id = p_actor)) then
    raise exception 'Boîte courriel introuvable' using errcode = '42501';
  end if;
  if p_gmail_thread_ids is null or pg_catalog.cardinality(p_gmail_thread_ids) > 100 then
    raise exception 'At most 100 threads' using errcode = '22023';
  end if;
  return query
  select t.gmail_thread_id, t.id
    from public.mail_threads t
   where t.org_id = p_org_id and t.connection_id = p_connection_id
     and t.gmail_thread_id = any (p_gmail_thread_ids)
   order by t.gmail_thread_id;
end;
$$;

revoke all on function public.get_mail_search_threads_for_service(uuid, uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.get_mail_search_threads_for_service(uuid, uuid, uuid, text[]) to service_role;

select pg_catalog.set_config('app.audit_source', '', true);
