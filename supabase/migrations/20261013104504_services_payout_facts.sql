-- =============================================================================
-- Services et tarifs: what Facturation's payroll (FPay) reads of a service, published as a helper
-- =============================================================================
-- The payroll picks the rule of a line by its service (a session at the grid, a report at the
-- « Autres frais » rate, a cancellation fee…) and prices a session by its duration, for a retired
-- service too (an old appointment's), without reading this module's tables (CLAUDE.md §5).
-- p_ids null: every service of the clinic (Paramètres → Paie lists them). For definer callers
-- after their own permission check, with the org they verified; granted to no role. No row for
-- another clinic's or an unknown service.
-- =============================================================================

create function private.service_payout_facts(p_org uuid, p_ids uuid[])
returns table (
  service_id uuid, code int, key text, name text, kind text, duration_minutes int, grid_duration int,
  is_active boolean, family_code int, family_name text, sort_order int
)
language sql
stable
set search_path = ''
as $$
  select s.id, s.code, s.key, s.name, s.kind, s.duration_minutes::int, s.grid_duration::int,
         s.is_active, f.code::int, f.name, s.sort_order
    from public.services s
    join public.service_families f on f.org_id = s.org_id and f.id = s.family_id
   where s.org_id = p_org and (p_ids is null or s.id = any (p_ids))
$$;
revoke all on function private.service_payout_facts(uuid, uuid[]) from public, anon, authenticated, service_role;
