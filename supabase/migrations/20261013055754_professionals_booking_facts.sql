-- Professionnels: what Rendez-vous needs to book a professional (plan R1), published as a
-- private helper so its definer RPCs never read this module's tables, and so a professional
-- booking her own agenda (appointments.self, without professionals.view) is served the same.
-- For definer callers after their own permission check, with the org they verified; granted to
-- no role. Returns no row for another clinic's or an unknown professional.
create function private.professional_booking_facts(p_org uuid, p_professional_id uuid)
returns table (status text, title_ids uuid[], women_only boolean, min_client_age smallint)
language sql
stable
set search_path = ''
as $$
  select p.status,
         coalesce((select pg_catalog.array_agg(pp.profession_title_id order by pp.is_primary desc, pp.created_at)
                     from public.professional_professions pp
                    where pp.org_id = p.org_id and pp.professional_id = p.id), '{}'),
         coalesce(mp.women_only, false),
         mp.min_client_age
    from public.professionals p
    left join public.professional_matching_profiles mp on mp.professional_id = p.id
   where p.org_id = p_org and p.id = p_professional_id
$$;
revoke all on function private.professional_booking_facts(uuid, uuid) from public, anon, authenticated, service_role;
