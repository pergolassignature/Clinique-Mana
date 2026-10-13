-- =============================================================================
-- Demandes D5: places left per professional, capacity snapshots, the availability board
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D5); research
--            docs/research/2026-10-08-intake-workbook.md §3 (« MATRICE Bonifiée » and the board)
-- Decisions: D-31 … D-33 (this batch), D-30 (places left), P4-553 (« Recommencer le décompte »)
-- Needs:     D4's `private.demandes_places_left`; Professionnels' `private.professional_matching_facts`
--            and `set_professional_new_client_places` (*_professionals_places_restart.sql).
--
-- * `list_professional_capacity()` (D-31; `demandes.view` and `professionals.view`, first): the
--   board — every active professional of the clinic, by name (the workbook's order, never a
--   ranking: the panel ranks for a request), with her places (declared, taken, left, since when),
--   whether she accepts new clients, her periods and languages, « À prioriser » and
--   « Bon à savoir », and the requests matched to her in the last 30 days. Totals: places left
--   across the tracked ones (the workbook's « TOTAL DES DISPONIBILITÉS (restantes) »).
-- * `capacity_snapshots` (D-32): one row per active professional per clinic day — declared,
--   taken, left, accepting — written by the SQL job `demandes.capacity_snapshots` (maintenance,
--   every night at 8:45 UTC, about 4:45 in Montréal: each row is the state at the start of the
--   clinic's day; « Exécuter maintenant » takes it again: the day's row is replaced). Read by D6's
--   indicators and D4's « Place disponible ». Computed figures, not audited (000_invariants); kept
--   (about 50 rows a day: no purge). One clinic's failure fails the run for all (one clinic
--   today; `run_sql_job` reports the code). Staff read them (`demandes.view`).
-- Additive: one table, functions, one job.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_capacity', true);

create table public.capacity_snapshots (
  org_id uuid not null,
  professional_id uuid not null,
  snapshot_on date not null,
  places_declared smallint,
  places_used int,
  places_left int,
  accepting_new_clients boolean not null,
  -- When the photo was taken (a rerun the same day takes it again).
  taken_at timestamptz not null default now(),
  constraint capacity_snapshots_pkey primary key (org_id, professional_id, snapshot_on),
  constraint capacity_snapshots_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint capacity_snapshots_places_check check (
    (places_declared is null) = (places_left is null) and (places_declared is null) = (places_used is null)
    and coalesce(places_left, 0) >= 0 and coalesce(places_used, 0) >= 0)
);
create index capacity_snapshots_org_day_idx on public.capacity_snapshots (org_id, snapshot_on);
alter table public.capacity_snapshots enable row level security;
revoke all on public.capacity_snapshots from anon, authenticated;
grant select on public.capacity_snapshots to authenticated;
create policy capacity_snapshots_select on public.capacity_snapshots
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.view')));

-- -----------------------------------------------------------------------------
-- The snapshots (the job)
-- -----------------------------------------------------------------------------
-- One clinic: today's row for every active professional (replaced when run again the same day).
create function private.demandes_capacity_snapshot(p_org uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_day date := private.clinic_today_for_org(p_org);
  v_n int;
begin
  insert into public.capacity_snapshots as c (org_id, professional_id, snapshot_on, places_declared, places_used, places_left, accepting_new_clients)
  select p_org, f.professional_id, v_day, pl.places_declared, pl.places_used, pl.places_left, f.accepting_new_clients
    from private.professional_matching_facts(p_org) f
    left join private.demandes_places_left(p_org) pl on pl.professional_id = f.professional_id
   where f.status = 'active'
  on conflict (org_id, professional_id, snapshot_on) do update
    set places_declared = excluded.places_declared, places_used = excluded.places_used,
        places_left = excluded.places_left, accepting_new_clients = excluded.accepting_new_clients,
        taken_at = pg_catalog.now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.demandes_capacity_snapshot(uuid) from public, anon, authenticated, service_role;

-- Every clinic with Demandes and Professionnels on.
create function private.job_demandes_capacity_snapshots()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_orgs int := 0;
  v_rows int := 0;
begin
  for v_org in
    select o.id from public.organizations o
     where public.module_enabled_for_org(o.id, 'demandes') and public.module_enabled_for_org(o.id, 'professionals')
     order by o.id
  loop
    v_rows := v_rows + private.demandes_capacity_snapshot(v_org);
    v_orgs := v_orgs + 1;
  end loop;
  return 'orgs=' || v_orgs || ' rows=' || v_rows;
end;
$$;
revoke all on function private.job_demandes_capacity_snapshots() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('demandes.capacity_snapshots', 'demandes', 'Photo des places des professionnels',
   'Note chaque nuit, pour chaque professionnel actif, ses places offertes, prises et restantes, et s''il accepte de nouveaux clients. Sert aux indicateurs de Demandes et à l''avis « Place disponible ». Relancée le même jour, elle remplace la photo du jour.',
   'sql', null, 'private.job_demandes_capacity_snapshots', 'demandes.capacity_snapshots', null, true)
on conflict do nothing;

select cron.schedule('demandes.capacity_snapshots', '45 8 * * *',
  $$select private.run_sql_job('demandes.capacity_snapshots')$$);

-- -----------------------------------------------------------------------------
-- The board
-- -----------------------------------------------------------------------------
create function public.list_professional_capacity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  perform private.demandes_require('demandes.view');
  perform private.demandes_require('professionals.view');
  return (
    with f as (
      select x.* from private.professional_matching_facts(v_org) x where x.status = 'active'
    ),
    board as (
      select f.professional_id, f.display_name, f.primary_title_label, f.accepting_new_clients, f.availability_periods,
             f.matching_note, f.matching_priority_reason,
             pl.places_declared, pl.places_used, pl.places_left, pl.places_set_at,
             coalesce((select pg_catalog.jsonb_agg(l.name order by l.sort_order, l.name)
                         from public.languages_catalog l where l.org_id = v_org and l.code = any (f.language_codes)), '[]') as languages,
             (select pg_catalog.count(*)::int from public.demandes d
               where d.org_id = v_org and d.matched_professional_id = f.professional_id
                 and d.matched_at >= pg_catalog.now() - interval '30 days') as matched_30_days
        from f
        left join private.demandes_places_left(v_org) pl on pl.professional_id = f.professional_id
    )
    select pg_catalog.jsonb_build_object(
      'total_left', coalesce((select pg_catalog.sum(r.places_left) from board r), 0),
      'tracked', (select pg_catalog.count(*) from board r where r.places_declared is not null),
      'with_places', (select pg_catalog.count(*) from board r where r.places_left > 0),
      'last_snapshot_on', (select pg_catalog.max(c.snapshot_on) from public.capacity_snapshots c where c.org_id = v_org),
      'professionals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.display_name, r.professional_id) from board r), '[]'))
  );
end;
$$;
revoke all on function public.list_professional_capacity() from public, anon;
grant execute on function public.list_professional_capacity() to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
