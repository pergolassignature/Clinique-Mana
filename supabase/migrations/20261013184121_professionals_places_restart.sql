-- =============================================================================
-- Professionnels: the places offered, set from Demandes' board, with « recommencer le décompte »
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D5); docs/modules/professionals.md rule 11
-- Decisions: P4-553 (this migration), P4-382 / P4-387 (places offered, places left in Demandes)
--
-- * `set_professional_new_client_places(id, places, restart default false)`
--   (`professionals.matching`): the number of new clients she can take (0–99, null = not
--   tracked), from Demandes' availability board (D5). The database stamps the day the number
--   changes (P4-382); `restart` stamps today even when the number is the same: « Recommencer le
--   décompte » (rule 11: Demandes counts the places taken since that day). Audited (the matching
--   profile's trigger).
-- * `private.stamp_new_client_places` widened (same trigger): the restart is the transaction's
--   setting `app.restart_places_count`, set by the RPC only.
-- Additive: one function, one trigger function replaced (same signature).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_places_restart', true);

create or replace function private.stamp_new_client_places()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.new_client_places is not distinct from old.new_client_places
     and coalesce(pg_catalog.current_setting('app.restart_places_count', true), '') <> 'on' then
    new.new_client_places_set_at := old.new_client_places_set_at;
  else
    new.new_client_places_set_at := case when new.new_client_places is not null then pg_catalog.now() end;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_new_client_places() from public, anon, authenticated, service_role;

-- Returns {new_client_places, new_client_places_set_at}.
create function public.set_professional_new_client_places(p_id uuid, p_places int, p_restart boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.professional_matching_profiles;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  perform private.lock_professional(p_id);
  if p_places is not null and p_places not between 0 and 99 then
    raise exception 'Le nombre de places va de 0 à 99.' using errcode = 'P0001', hint = 'places';
  end if;
  if coalesce(p_restart, false) and p_places is null then
    raise exception 'On recommence le décompte de places suivies : indiquez le nombre.' using errcode = 'P0001', hint = 'places';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_professional_new_client_places', true);
  perform pg_catalog.set_config('app.restart_places_count', case when coalesce(p_restart, false) then 'on' else 'off' end, true);
  update public.professional_matching_profiles mp
     set new_client_places = p_places::smallint
   where mp.professional_id = p_id
     and (mp.new_client_places is distinct from p_places::smallint or coalesce(p_restart, false))
  returning mp.* into v;
  perform pg_catalog.set_config('app.restart_places_count', 'off', true);
  if v.professional_id is not null then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  else
    select mp.* into v from public.professional_matching_profiles mp where mp.professional_id = p_id;
  end if;
  return pg_catalog.jsonb_build_object('new_client_places', v.new_client_places, 'new_client_places_set_at', v.new_client_places_set_at);
end;
$$;
revoke all on function public.set_professional_new_client_places(uuid, int, boolean) from public, anon;
grant execute on function public.set_professional_new_client_places(uuid, int, boolean) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
