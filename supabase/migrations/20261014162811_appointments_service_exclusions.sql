-- =============================================================================
-- Rendez-vous: never a service the professional does not offer (decision R-83)
-- =============================================================================
-- Decision: R-83 (decisions log); Services et tarifs' list of the services a professional does not
--           offer (`20261014162731_services_professional_exclusions.sql`), read through its
--           published helper `private.service_excluded_for` (never its table).
--
-- * A guard on `appointments` (BEFORE INSERT, and UPDATE OF service_id or professional_id): a
--   booking, a hold, a series, a proposal's appointment or a move to another professional or
--   service is refused in French (P0001, HINT `service_id`, « Ce professionnel n'offre pas ce
--   service. ») when she does not offer the service. A trigger rather than a change to every
--   booking RPC (they all reach this table), so the rule holds whoever writes. Untouched: a
--   personal appointment (no service), a move in time (same service and professional), and an
--   imported appointment (`external_ref` on insert: GOrendezvous's history is kept as it was).
-- * « Mon agenda »'s reference (`get_my_agenda_reference`, latest body
--   20261013100856_appointments_publications.sql): her services leave out the ones she does not
--   offer. The staff's pickers read `services_catalog.excluded_professional_ids` (the app).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_service_exclusions', true);

-- Definer: whoever writes the row (a definer RPC, the service role), the list is read the same way.
create function private.appointments_check_service_offered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.external_ref is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.service_id is not distinct from old.service_id and new.professional_id is not distinct from old.professional_id then
    return new;
  end if;
  if private.service_excluded_for(new.org_id, new.professional_id, new.service_id) then
    raise exception 'Ce professionnel n''offre pas ce service.' using errcode = 'P0001', hint = 'service_id';
  end if;
  return new;
end;
$$;
revoke all on function private.appointments_check_service_offered() from public, anon, authenticated, service_role;

create trigger appointments_check_service_offered
  before insert or update of service_id, professional_id on public.appointments
  for each row execute function private.appointments_check_service_offered();

-- « Mon agenda »'s reference: the professional herself and the services she offers.
create or replace function public.get_my_agenda_reference()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_me uuid := private.current_professional_id();
  v_pro record;
begin
  if v_me is null or not private.has_permission('appointments.self') then
    raise exception 'Permission refusée : appointments.self' using errcode = '42501';
  end if;
  select * into v_pro from private.professional_booking_facts(v_org, v_me);
  return pg_catalog.jsonb_build_object(
    'professional', pg_catalog.jsonb_build_object(
      'id', v_me,
      'display_name', (select n.display_name from private.professional_display_names(v_org, array[v_me]) n),
      'status', v_pro.status,
      'professions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('title_id', x)) from pg_catalog.unnest(v_pro.title_ids) x), '[]'::jsonb)),
    'services', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', s.id, 'code', s.code, 'name', s.name, 'duration_minutes', s.duration_minutes,
               'buffer_after_minutes', s.buffer_after_minutes, 'for_two', s.for_two, 'colour', s.colour,
               'title_ids', s.title_ids) order by s.code)
        from public.services_catalog s
       where s.org_id = v_org and s.duration_minutes > 0
         and (pg_catalog.cardinality(s.title_ids) = 0 or s.title_ids && coalesce(v_pro.title_ids, '{}'))
         -- R-83: never one she does not offer.
         and not private.service_excluded_for(v_org, v_me, s.id)), '[]'::jsonb));
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
