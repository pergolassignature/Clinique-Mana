-- =============================================================================
-- Professionnels: the retention grid's client price in force (plan S2.1)
-- =============================================================================
-- Plan:     docs/plans/2026-10-11-modules-coding-plan.md §5.2 (« Needs from Professionnels »)
-- Decision: R-4 (client prices come from the retention grids; Services et tarifs stores no copy)
--
-- Services et tarifs prices a « grid » service by asking this helper for the client price of a
-- duration (60 couple / 50 / 30) of the profession title's grid in force on a date. It is a
-- `private` helper granted to no role: it runs inside the definer RPCs of the modules that
-- price (Services et tarifs today, Rendez-vous and Facturation later), after their own permission
-- check, so it bypasses nothing by itself. The org is passed explicitly, as every private helper
-- a module calls (core_module_helpers): a definer caller scopes to the org it already verified.
-- Null when the title has no grid in force on that date, or when the grid does not price the
-- duration (« Non offert »), or for a null title: the caller shows « À confirmer ».
-- =============================================================================

create function private.grid_client_price(p_org uuid, p_title_id uuid, p_duration smallint, p_on date)
returns int
language sql
stable
set search_path = ''
as $$
  select gp.client_price_cents
    from public.retention_grids g
    join public.retention_grid_prices gp on gp.org_id = g.org_id and gp.grid_id = g.id
   where g.org_id = p_org
     and g.title_id = p_title_id
     and gp.duration = p_duration
     and g.effective_from <= p_on
     and (g.effective_to is null or p_on < g.effective_to)
$$;
revoke all on function private.grid_client_price(uuid, uuid, smallint, date) from public, anon, authenticated, service_role;
