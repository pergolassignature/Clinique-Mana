-- =============================================================================
-- Demandes: a proposal offers only the services the professional offers (decision R-83)
-- =============================================================================
-- Decision: R-83 (decisions log); Services et tarifs' published helper
--           `private.service_excluded_for` (`20261014162731_services_professional_exclusions.sql`).
--
-- `proposition_services(professional)` (the proposal's form, latest body
-- 20261013095548_demandes_propositions.sql) now leaves out the services she does not offer; the
-- booking guard of Rendez-vous refuses them anyway (`20261014162811_appointments_service_exclusions`).
-- `private.demandes_default_service` (« Prochaine disponibilité », latest body
-- 20261014010723_demandes_audit_followups.sql) skips them too: a couple request whose couple
-- service she does not offer falls back to her next session (the 50-minute one first).
-- Same signatures, grants kept.
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

-- Her default service for a request (D-48): one of her titles' sessions (or a clinic session)
-- with a length, never one she does not offer (R-83); a couple's service for a couple, else the
-- 50-minute session, else the shortest code. Null when she has none.
create or replace function private.demandes_default_service(p_org uuid, p_professional_id uuid, p_for_two boolean)
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id
    from public.services_catalog s
   cross join private.professional_booking_facts(p_org, p_professional_id) f
   where s.org_id = p_org and s.kind = 'session' and s.duration_minutes > 0
     and (s.title_ids = '{}' or s.title_ids && f.title_ids)
     and not private.service_excluded_for(p_org, p_professional_id, s.id)
   order by (s.for_two = coalesce(p_for_two, false)) desc, (s.duration_minutes = 50) desc, s.code
   limit 1
$$;

select pg_catalog.set_config('app.audit_source', '', true);
