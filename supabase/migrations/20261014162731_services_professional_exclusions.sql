-- =============================================================================
-- Services et tarifs: the services a professional does not offer (decision R-83)
-- =============================================================================
-- Decision: R-83 (decisions log, « Christine's answers, second series », answer 17: « certains
--           n'offrent pas tous les services de leur titre ; une liste par professionnel convient »).
-- Before:   S-11 « Services offerts » was read-only, the services of her titles (`service_titles`).
--
-- A professional's offered services = the active services one of her titles offers, minus the
-- ones listed here. Owned by Services et tarifs (it owns the catalogue and « Services offerts »,
-- and depends on Professionnels; the professional is referenced by a composite FK, as Rendez-vous'
-- availability does). Default decisions — révisables:
-- * `service_professional_exclusions (org_id, professional_id, service_id)`: one row per service
--   she does NOT offer (all on by default: no row). Only a service one of her titles offers can be
--   listed; a clinic service (no title: the discovery call, the waiting list) is everyone's.
--   Audited; the primary key starts with the professional (her history finds it). A title removed
--   later leaves its rows: they no longer matter (the service is not hers anyway) and are dropped
--   at the next save.
-- * Read with services.view: the staff holding professionals.view read every professional's, a
--   professional only her own (`private.current_professional_id()`).
-- * `set_professional_service_exclusions(professional, service_ids[])` replaces the list: on the
--   professional's record (Jumelage, « Services offerts »), for whoever holds professionals.manage
--   (the clinic's say on who does what) and services.view (the module gate). Returns how many
--   services she does not offer.
-- * Published: `services_catalog.excluded_professional_ids` (appended; the pickers of Rendez-vous
--   and Facturation already read the view) and `private.service_excluded_for(org, professional,
--   service)` for definer code (Rendez-vous' booking guard, « Mon agenda », Demandes' proposals).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:services_professional_exclusions', true);

-- -----------------------------------------------------------------------------
-- The table
-- -----------------------------------------------------------------------------
create table public.service_professional_exclusions (
  org_id uuid not null,
  professional_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint service_professional_exclusions_pkey primary key (professional_id, service_id),
  constraint service_professional_exclusions_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint service_professional_exclusions_service_fkey foreign key (org_id, service_id)
    references public.services (org_id, id) on delete cascade
);
create index service_professional_exclusions_org_service_idx on public.service_professional_exclusions (org_id, service_id);
create index service_professional_exclusions_created_by_idx on public.service_professional_exclusions (created_by);

revoke all on public.service_professional_exclusions from anon, authenticated;
grant select on public.service_professional_exclusions to authenticated;
alter table public.service_professional_exclusions enable row level security;

-- The staff who read the professionals read every one's; a professional her own.
create policy service_professional_exclusions_select on public.service_professional_exclusions
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and (select private.has_permission('services.view'))
         and ((select private.has_permission('professionals.view'))
              or professional_id = (select private.current_professional_id())));

create trigger service_professional_exclusions_audit after insert or update or delete on public.service_professional_exclusions
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Published: the catalogue, with who does not offer each service (appended column)
-- -----------------------------------------------------------------------------
create or replace view public.services_catalog with (security_invoker = true) as
select s.id, s.org_id, s.code, s.key, s.name, s.description, s.kind,
       s.duration_minutes, s.buffer_after_minutes, s.for_two,
       s.price_source, s.fixed_price_cents, s.grid_duration, s.tax_rule, s.colour, s.sort_order,
       f.id as family_id, f.code as family_code, f.name as family_name, f.sort_order as family_sort_order,
       coalesce(t.ids, '{}') as title_ids,
       coalesce(t.keys, '{}') as title_keys,
       s.updated_at,
       coalesce(ex.ids, '{}') as excluded_professional_ids
  from public.services s
  join public.service_families f on f.org_id = s.org_id and f.id = s.family_id
  -- One pre-aggregated join (grouped once per statement), never a call per row.
  left join (select x.service_id,
                    array_agg(x.profession_title_id order by pt.sort_order, pt.key) as ids,
                    array_agg(pt.key order by pt.sort_order, pt.key) as keys
               from public.service_titles x
               join public.profession_titles pt on pt.org_id = x.org_id and pt.id = x.profession_title_id
              group by x.service_id) t on t.service_id = s.id
  -- R-83: as the caller reads them (the staff every professional, a professional her own).
  left join (select e.service_id, array_agg(e.professional_id order by e.professional_id) as ids
               from public.service_professional_exclusions e
              group by e.service_id) ex on ex.service_id = s.id
 where s.is_active;

-- For definer code (Rendez-vous, Demandes), after its own checks, with the org it verified:
-- whether this professional does not offer this service. Granted to no role.
create function private.service_excluded_for(p_org uuid, p_professional_id uuid, p_service_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.service_professional_exclusions e
                  where e.org_id = p_org and e.professional_id = p_professional_id and e.service_id = p_service_id)
$$;
revoke all on function private.service_excluded_for(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The RPC: replaces the services she does not offer
-- -----------------------------------------------------------------------------
create function public.set_professional_service_exclusions(p_professional_id uuid, p_service_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[];
  v_titles uuid[];
  v_status text;
  v_count int;
begin
  if not (private.has_permission('professionals.manage') and private.has_permission('services.view')) then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  select coalesce(pg_catalog.array_agg(distinct s), '{}') into v_ids from pg_catalog.unnest(coalesce(p_service_ids, '{}')) s where s is not null;
  if pg_catalog.cardinality(v_ids) > 200 then
    raise exception 'Too many services' using errcode = '22023';
  end if;
  -- Professionnels' published facts (never its tables): her titles, whatever her status.
  select f.status, f.title_ids into v_status, v_titles from private.professional_booking_facts(v_org, p_professional_id) f;
  if v_status is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001', hint = 'professional_id';
  end if;
  -- One writer of her list at a time.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('service_professional_exclusions:' || p_professional_id::text, 0));
  if exists (select 1 from pg_catalog.unnest(v_ids) s
              where not exists (select 1 from public.services v
                                 where v.org_id = v_org and v.id = s and v.is_active
                                   and exists (select 1 from public.service_titles st
                                                where st.org_id = v.org_id and st.service_id = v.id
                                                  and st.profession_title_id = any (coalesce(v_titles, '{}'))))) then
    raise exception 'Un des services choisis n''est pas offert par ses professions.' using errcode = 'P0001', hint = 'service_ids';
  end if;

  delete from public.service_professional_exclusions e
   where e.org_id = v_org and e.professional_id = p_professional_id and not (e.service_id = any (v_ids));
  insert into public.service_professional_exclusions (org_id, professional_id, service_id, created_by)
  select v_org, p_professional_id, s, auth.uid() from pg_catalog.unnest(v_ids) s
  on conflict do nothing;
  select pg_catalog.count(*)::int into v_count from public.service_professional_exclusions e
   where e.org_id = v_org and e.professional_id = p_professional_id;
  return v_count;
end;
$$;
revoke all on function public.set_professional_service_exclusions(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_professional_service_exclusions(uuid, uuid[]) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
