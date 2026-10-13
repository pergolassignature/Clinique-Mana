-- Clients: what Rendez-vous needs to book clients (plan R1), published as a private helper so
-- its definer RPCs never read this module's tables, and so a professional booking her own
-- agenda (appointments.self, without clients.view) is served the same: per id, in the given
-- order, whether the file is the clinic's and usable (not archived, merged or anonymised), and
-- the two facts a professional's limits read (sex, birthday). Nothing else. For definer
-- callers after their own permission check, with the org they verified; granted to no role.
create function private.clients_booking_facts(p_org uuid, p_client_ids uuid[])
returns table (ord int, client_id uuid, found boolean, sex text, birthday date, is_archived boolean, is_closed boolean)
language sql
stable
set search_path = ''
as $$
  select x.ord::int, x.id, c.id is not null, c.sex, c.birthday,
         coalesce(c.archived_at is not null, false),
         coalesce(c.merged_into_id is not null or c.anonymized_at is not null, false)
    from pg_catalog.unnest(coalesce(p_client_ids, '{}'::uuid[])) with ordinality as x(id, ord)
    left join public.clients c on c.org_id = p_org and c.id = x.id
   order by x.ord
$$;
revoke all on function private.clients_booking_facts(uuid, uuid[]) from public, anon, authenticated, service_role;
