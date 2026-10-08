-- =============================================================================
-- Professionnels: the public fees on the fiche (« Honoraires »)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4c.5 (P4-218, amends P4-204
--          and P4-213).
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The fiche prints the clinic's public fees: the client prices of the retention grid in force
--   today for the fiche's title (« Rencontre 50 min : 175 $ »). The grids are readable only with
--   professionals.compensation (their tiers say what the clinic retains), but the conseillères
--   (professionals.view) make and send fiches. get_professional_public_fees is the narrow door:
--   definer, professionals.view, and it returns the duration and the client price only. Never a
--   tier, a retention, a pay, a session count or a client agreement.
-- * The title: the one given (two titles: the fiche's chosen title), which must be one of the
--   professional's, else the primary one. No title, or no grid in force today → an empty array, and
--   the fiche reads « À confirmer ».
-- * Any status, as mark_professional_fiche_generated: a draft's fiche can be previewed.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:professionals_public_fees', true);

-- [{duration, client_price_cents}], 60 then 50 then 30 min, of one professional of the caller's
-- clinic, for p_title_id (one of theirs) or their primary title, from the grid in force on the
-- clinic's today.
create function public.get_professional_public_fees(p_id uuid, p_title_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_title uuid;
  v_today date := private.clinic_today();
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;

  if p_title_id is null then
    select pp.profession_title_id into v_title
      from public.professional_professions pp
     where pp.professional_id = p_id and pp.org_id = v_org and pp.is_primary;
  else
    select pp.profession_title_id into v_title
      from public.professional_professions pp
     where pp.professional_id = p_id and pp.org_id = v_org and pp.profession_title_id = p_title_id;
    if v_title is null then
      raise exception 'Titre introuvable.' using errcode = 'P0001';
    end if;
  end if;

  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'duration', gp.duration, 'client_price_cents', gp.client_price_cents)
             order by gp.duration desc), '[]'::jsonb)
      from public.retention_grids g
      join public.retention_grid_prices gp on gp.org_id = g.org_id and gp.grid_id = g.id
     where g.org_id = v_org and g.title_id = v_title
       and g.effective_from <= v_today and (g.effective_to is null or v_today < g.effective_to));
end;
$$;
revoke all on function public.get_professional_public_fees(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_professional_public_fees(uuid, uuid) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
