-- =============================================================================
-- Services et tarifs: a service by its code (GOrendezvous import, I3)
-- =============================================================================
-- Asked:     coordinator, 2026-10-13 (the billing import)
-- Decisions: BI-20 (decisions log)
--
-- `private.service_id_by_code(org, code)` (granted to no role): the clinic's service of that
-- five-digit code (« 10150 »), active or not, for Facturation's import of GOrendezvous lines.
-- =============================================================================

create function private.service_id_by_code(p_org uuid, p_code int)
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id from public.services s where s.org_id = p_org and s.code = p_code
$$;
revoke all on function private.service_id_by_code(uuid, int) from public, anon, authenticated, service_role;
