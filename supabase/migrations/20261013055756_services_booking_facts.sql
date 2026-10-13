-- Services et tarifs: what Rendez-vous needs to book or move a service (plan R1), published as a
-- private helper so its definer RPCs never read this module's tables. Unlike `services_catalog`
-- (active services only, for pickers), it answers for a retired service too, so an appointment
-- booked before the service was retired can still be moved or listed (`is_active` says which).
-- For definer callers after their own permission check, with the org they verified; granted to
-- no role. No row for another clinic's or an unknown service.
create function private.service_booking_facts(p_org uuid, p_service_id uuid)
returns table (is_active boolean, code int, duration_minutes int, buffer_after_minutes int, for_two boolean, title_ids uuid[])
language sql
stable
set search_path = ''
as $$
  select s.is_active, s.code, s.duration_minutes::int, s.buffer_after_minutes::int, s.for_two,
         coalesce((select pg_catalog.array_agg(st.profession_title_id) from public.service_titles st
                    where st.org_id = s.org_id and st.service_id = s.id), '{}')
    from public.services s
   where s.org_id = p_org and s.id = p_service_id
$$;
revoke all on function private.service_booking_facts(uuid, uuid) from public, anon, authenticated, service_role;
