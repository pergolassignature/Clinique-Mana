-- =============================================================================
-- Professionnels: names and accounts for Rendez-vous (RZ, R4), published as private helpers
-- =============================================================================
-- Rendez-vous' definer code and jobs (the video-link email « avec {professionnel} », R4's
-- reminders, the Zoom connection of a professional) need a professional's name and the link
-- between a professional and her account, without reading this module's tables (CLAUDE.md §5,
-- AP-9) and without `professionals.view` (a job, a professional acting on her own agenda).
-- For definer callers after their own permission check, with the org they verified; granted to
-- no role. Unknown ids or another clinic's: no row (or null).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_appointments_facts', true);

-- Display names, as `professionals_directory` writes them (« Prénom Nom »).
create function private.professional_display_names(p_org uuid, p_ids uuid[])
returns table (professional_id uuid, display_name text)
language sql
stable
set search_path = ''
as $$
  select p.id, p.first_name || ' ' || p.last_name
    from public.professionals p
   where p.org_id = p_org and p.id = any (coalesce(p_ids, '{}'))
$$;
revoke all on function private.professional_display_names(uuid, uuid[]) from public, anon, authenticated, service_role;

-- The professional of an account (a profile of the clinic), or null.
create function private.professional_for_profile(p_org uuid, p_profile uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select p.id from public.professionals p where p.org_id = p_org and p.profile_id = p_profile
$$;
revoke all on function private.professional_for_profile(uuid, uuid) from public, anon, authenticated, service_role;

-- The account of a professional, or null (not invited yet).
create function private.professional_profile_id(p_org uuid, p_professional uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select p.profile_id from public.professionals p where p.org_id = p_org and p.id = p_professional
$$;
revoke all on function private.professional_profile_id(uuid, uuid) from public, anon, authenticated, service_role;
