-- =============================================================================
-- Demandes: a proposal books every file of a family (R-79)
-- =============================================================================
-- Asked:   Christine, second series, answer 10 (2026-10-14), decision R-79: an appointment brings
--          together more than two clients, each with her own file.
-- Needs:   *_demandes_parity.sql (demandes_booking_clients), *_appointments_participants.sql
--          (Rendez-vous' published `private.appointments_max_clients()`).
--
-- `private.demandes_booking_clients` (same signature): the request's file then its participants'
-- other files, all of them, up to Rendez-vous' maximum (6); a couple service still books exactly
-- two (one file asks for the second person's; three or more are refused in plain words). Before, a
-- request with three files or more was refused (« réservez ce rendez-vous dans l'agenda »).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_family_booking', true);

create or replace function private.demandes_booking_clients(p_org uuid, p_demande uuid, p_for_two boolean)
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_client uuid;
  v_ids uuid[];
  v_max int := private.appointments_max_clients();
begin
  select d.client_id into v_client from public.demandes d where d.id = p_demande and d.org_id = p_org;
  if v_client is null then
    raise exception 'Rattachez d''abord le dossier du client (onglet Accueil).' using errcode = 'P0001', hint = 'client_id';
  end if;
  v_ids := array[v_client] || coalesce((
    select array_agg(x.client_id order by x.is_primary desc, x.created_at, x.id)
      from (select distinct on (p.client_id) p.client_id, p.is_primary, p.created_at, p.id
              from public.demande_participants p
             where p.demande_id = p_demande and p.org_id = p_org and p.client_id is not null and p.client_id <> v_client
             order by p.client_id, p.is_primary desc, p.created_at, p.id) x), '{}');
  if coalesce(p_for_two, false) and pg_catalog.cardinality(v_ids) < 2 then
    raise exception 'Ce service se réserve pour deux personnes : ajoutez le dossier de la deuxième personne (onglet Participants).'
      using errcode = 'P0001', hint = 'participants';
  end if;
  if coalesce(p_for_two, false) and pg_catalog.cardinality(v_ids) > 2 then
    raise exception 'Ce service se réserve pour deux personnes, et cette demande en a % avec un dossier : choisissez un autre service, ou réservez ce rendez-vous dans l''agenda.',
      pg_catalog.cardinality(v_ids) using errcode = 'P0001', hint = 'participants';
  end if;
  if pg_catalog.cardinality(v_ids) > v_max then
    raise exception 'Un rendez-vous compte % clients au plus, et cette demande en a % avec un dossier : réservez ce rendez-vous dans l''agenda.',
      v_max, pg_catalog.cardinality(v_ids) using errcode = 'P0001', hint = 'participants';
  end if;
  return v_ids;
end;
$$;
revoke all on function private.demandes_booking_clients(uuid, uuid, boolean) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
