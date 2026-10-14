-- =============================================================================
-- Demandes: a proposal offers only the services the professional offers (decision R-83)
-- =============================================================================
-- Decision: R-83 (decisions log); Services et tarifs' published helper
--           `private.service_excluded_for` (`20261014162731_services_professional_exclusions.sql`).
--
-- `proposition_services(professional)` (the proposal's form, latest body
-- 20261013095548_demandes_propositions.sql) now leaves out the services she does not offer; the
-- booking guard of Rendez-vous refuses them anyway (`20261014162811_appointments_service_exclusions`).
-- Same signature, grants kept.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_proposition_services_exclusions', true);

create or replace function public.proposition_services(p_professional_id uuid)
returns table (id uuid, code int, name text, duration_minutes int, for_two boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_titles uuid[];
begin
  perform private.demandes_require('demandes.manage');
  select f.title_ids into v_titles from private.professional_booking_facts(v_org, p_professional_id) f where f.status = 'active';
  if v_titles is null then
    return;
  end if;
  return query
    select s.id, s.code, s.name, s.duration_minutes::int, s.for_two
      from public.services_catalog s
     where s.org_id = v_org and s.duration_minutes > 0
       and (s.title_ids = '{}' or s.title_ids && v_titles)
       -- R-83: never one she does not offer.
       and not private.service_excluded_for(v_org, p_professional_id, s.id)
     order by s.family_sort_order, s.sort_order, s.code;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
