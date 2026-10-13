-- =============================================================================
-- Professionnels: what another module may show of a professional without a user
-- =============================================================================
-- `professionals_directory` filters on professionals.view, so it reads nothing in a job or behind
-- a public link (no user). Demandes needs a professional's public-facing facts there: the
-- proposal's email and page (D3b), the waiting list's follow-up email (D3). Published as a private
-- helper, like `professional_booking_facts`: for definer callers after their own checks, with the
-- org they verified; granted to no role. Only what the clinic shows publicly: the name as on the
-- fiche and the primary title (its feminine or masculine form, as the directory's
-- `primary_title_label`), and the status. Nothing private (no address, licence, rates, notes).
-- No row for another clinic's or an unknown professional. Additive: one function.
-- =============================================================================

create function private.professional_display_facts(p_org uuid, p_professional uuid)
returns table (display_name text, title text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.first_name || ' ' || p.last_name,
         private.profession_title_label(pt.name, pt.name_feminine, pt.name_masculine, p.gender),
         p.status
    from public.professionals p
    left join public.professional_professions pp on pp.org_id = p.org_id and pp.professional_id = p.id and pp.is_primary
    left join public.profession_titles pt on pt.org_id = pp.org_id and pt.id = pp.profession_title_id
   where p.org_id = p_org and p.id = p_professional
$$;
revoke all on function private.professional_display_facts(uuid, uuid) from public, anon, authenticated, service_role;
