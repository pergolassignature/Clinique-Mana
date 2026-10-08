-- =============================================================================
-- Professionnels: the fiche PDF, download (« Fiche PDF » → « Télécharger »)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4c.5 (pulled forward; P4-58,
--          P4-200–P4-209). The email is the next migration, *_professionals_fiche_email.sql.
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The fiche is rendered in the browser (@react-pdf/renderer, P4-58), from data the caller
--   already reads (get_professional_record, the catalogue, organizations). Nothing here renders,
--   and no copy of a downloaded fiche is kept (P4-19).
-- * professionals.fiche_generated_at: the last time anyone downloaded or emailed the fiche
--   (design A2.10). No client grant: it moves only through mark_professional_fiche_generated,
--   with professionals.view (the conseillères send fiches after the discovery call), whatever the
--   status (a draft's fiche can be previewed). The audit row it writes is not shown in Historique
--   (P4-203); the stamp also moves updated_at, which no screen shows and no save compares for
--   this table.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:professionals_fiche', true);

alter table public.professionals add column fiche_generated_at timestamptz;

-- Stamps the fiche of one professional of the caller's clinic as generated now; returns the stamp.
create function public.mark_professional_fiche_generated(p_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  update public.professionals p
     set fiche_generated_at = pg_catalog.now()
   where p.id = p_id and p.org_id = private.current_user_org_id()
  returning p.fiche_generated_at into v_at;
  if v_at is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  return v_at;
end;
$$;
revoke all on function public.mark_professional_fiche_generated(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_professional_fiche_generated(uuid) to authenticated;
