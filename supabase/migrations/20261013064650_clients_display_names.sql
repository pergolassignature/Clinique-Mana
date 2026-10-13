-- Clients: the names Rendez-vous' agenda shows for an appointment's clients (plan R2), published
-- as a private helper so its definer read never touches this module's tables: per id, the
-- display name and the file number, nothing else. For definer callers that return them only for
-- appointments the caller may read; granted to no role.
create function private.clients_display_names(p_org uuid, p_client_ids uuid[])
returns table (client_id uuid, display_name text, client_number int)
language sql
stable
set search_path = ''
as $$
  select c.id, c.first_name || ' ' || c.last_name, c.client_number
    from public.clients c
   where c.org_id = p_org and c.id = any (coalesce(p_client_ids, '{}'::uuid[]))
$$;
revoke all on function private.clients_display_names(uuid, uuid[]) from public, anon, authenticated, service_role;
