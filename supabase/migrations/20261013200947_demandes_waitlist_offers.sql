-- =============================================================================
-- Demandes D4, part 2: the waiting list meets the matching — « Place disponible », compatible
-- registrants in list order, « Offrir la plage », the next one on a refusal or no answer
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D4: waitlist part 2)
-- Decisions: D-34 … D-36 (this batch); D-27 … D-30 (the match); D-32 (the snapshots); D3b's
--            proposals (D-22 … D-24, the 48-h link on R1b's holds)
-- Needs:     D4's `private.demandes_match` / `demandes_match_criteria`; D5's `capacity_snapshots`.
--
-- * `private.demandes_waitlist_compatible(org, professional)` (D-36): the open entries she could be
--   offered — « Active » or « À rappeler » (the consent and the fee settled), no proposal pending —
--   of her own list and of her professions' lists, whose criteria she meets (D4's hard filters,
--   with the entry's own criteria: its language, periods, gender, clientèle, motifs; the person's
--   age and sex as the request's), in list order (« Prioritaire » first, then the oldest). Granted
--   to no role. `list_waitlist_compatible(professional)` (`demandes.view` and
--   `professionals.view`) shows them with the warnings.
-- * « Place disponible » (D-34): the nightly photo (D5) compares each professional with her last
--   one; a place opened (places left back above 0, new clients accepted again, newly active) while
--   someone compatible waits → one notice `demandes.waitlist_slot_available` (`demandes.waitlist`)
--   per professional per day, to `/liste-attente?liste=p-<her>`.
-- * « Offrir la plage » (D-35): the proposal of D3b (1 to 3 of her free slots held 48 h, one link),
--   from the compatible row; a proposal of hers declined or unanswered for a person on the list →
--   notice `demandes.waitlist_offer_next` (« Plage à offrir au suivant »), when someone else
--   compatible waits.
-- * No message leaves the clinic here: the notices are internal; the proposal keeps D3b's P3-40.
-- Additive: functions; two functions replaced (same signatures).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_waitlist_offers', true);

-- -----------------------------------------------------------------------------
-- Compatible registrants (D-36)
-- -----------------------------------------------------------------------------
create function private.demandes_waitlist_compatible(p_org uuid, p_professional uuid)
returns table (entry_id uuid, demande_id uuid, target_kind text, priority text, registered_at timestamptz,
               warnings text[], fit int, sort_key bigint)
language sql
stable
set search_path = ''
as $$
  with pro as (
    select f.professional_id, f.title_ids from private.professional_matching_facts(p_org, array[p_professional]) f
  ),
  entries as (
    select e.*
      from public.waitlist_entries e, pro
     where e.org_id = p_org and e.state in ('active', 'to_call')
       and (e.target_professional_id = p_professional or e.target_profession_title_id = any (pro.title_ids))
       and not exists (select 1 from public.demande_propositions x where x.demande_id = e.demande_id and x.response = 'pending')
  ),
  matched as (
    select e.id as entry_id, e.demande_id, case when e.target_professional_id is not null then 'professional' else 'title' end as target_kind,
           e.priority, e.registered_at, m.eligible, m.warnings, m.fit
      from entries e
      cross join lateral (
        select private.demandes_match_criteria(p_org, e.demande_id) || pg_catalog.jsonb_build_object(
                 'language', e.language,
                 'availability_periods', pg_catalog.to_jsonb(e.availability_periods),
                 'preferred_pro_gender', e.preferred_pro_gender,
                 'clientele_id', (select k.id from public.clienteles_catalog k where k.org_id = p_org and k.id = e.clientele_id),
                 'profession_title_id', e.target_profession_title_id,
                 'motif_ids', coalesce((select pg_catalog.jsonb_agg(c.id) from public.motifs_catalog c
                                         where c.org_id = p_org and c.id = any (e.motif_ids)), '[]')) as criteria
      ) cr
      cross join lateral private.demandes_match(p_org, cr.criteria, array[p_professional]) m
  )
  select x.entry_id, x.demande_id, x.target_kind, x.priority, x.registered_at, x.warnings, x.fit,
         pg_catalog.row_number() over (order by (x.priority = 'priority') desc, x.registered_at, x.entry_id)
    from matched x
   where x.eligible
$$;
revoke all on function private.demandes_waitlist_compatible(uuid, uuid) from public, anon, authenticated, service_role;

-- The compatible registrants of a professional, in list order, as the list shows them.
create function public.list_waitlist_compatible(p_professional_id uuid)
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
  if not exists (select 1 from private.professional_matching_facts(v_org, array[p_professional_id])) then
    raise exception 'Ce professionnel n''existe pas.' using errcode = 'P0001', hint = 'professional_id';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'entry_id', c.entry_id, 'demande_id', c.demande_id, 'reference', w.reference,
             -- The file's name, else the request's contact (no file yet).
             'person_name', coalesce(w.person_name, (select d.contact_name from public.demandes d where d.org_id = v_org and d.id = c.demande_id)),
             'client_number', w.client_number, 'target_kind', c.target_kind, 'target_name', w.target_name,
             'priority', c.priority, 'priority_reason', w.priority_reason, 'registered_at', c.registered_at,
             'waited_days', w.waited_days, 'state', w.state, 'rank', w.rank, 'list_size', w.list_size, 'warnings', pg_catalog.to_jsonb(c.warnings),
             'order', c.sort_key)
           order by c.sort_key)
      from private.demandes_waitlist_compatible(v_org, p_professional_id) c
      join private.waitlist_rows(v_org, null, null, null, null) w on w.id = c.entry_id), '[]');
end;
$$;
revoke all on function public.list_waitlist_compatible(uuid) from public, anon;
grant execute on function public.list_waitlist_compatible(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- « Place disponible » (D-34): the nightly photo, widened (from *_demandes_capacity.sql)
-- -----------------------------------------------------------------------------
create or replace function private.demandes_capacity_snapshot(p_org uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_day date := private.clinic_today_for_org(p_org);
  v_n int;
  v_had_before boolean;
  r record;
begin
  v_had_before := exists (select 1 from public.capacity_snapshots c where c.org_id = p_org and c.snapshot_on < v_day);
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
  -- D4 part 2 (D-34): a place opened since the last photo (places left back above 0, new clients
  -- accepted again, a professional newly active) and someone compatible waits: « Place disponible »,
  -- once a day per professional. Not on the clinic's first photo (nothing to compare).
  if v_had_before then
    for r in
      select t.professional_id
        from public.capacity_snapshots t
        left join lateral (select p.* from public.capacity_snapshots p
                            where p.org_id = p_org and p.professional_id = t.professional_id and p.snapshot_on < v_day
                            order by p.snapshot_on desc limit 1) prev on true
       where t.org_id = p_org and t.snapshot_on = v_day
         and t.accepting_new_clients and coalesce(t.places_left, 1) > 0
         and (prev.professional_id is null or not prev.accepting_new_clients or prev.places_left = 0)
    loop
      if exists (select 1 from private.demandes_waitlist_compatible(p_org, r.professional_id)) then
        perform private.notify(p_org, 'demandes', 'demandes.waitlist_slot_available', 'normal',
          'Place disponible',
          coalesce((select f.display_name from private.professional_display_facts(p_org, r.professional_id) f), 'Un professionnel')
            || ' a une place : des personnes compatibles attendent sur la liste d''attente.',
          '/liste-attente?liste=p-' || r.professional_id, 'professional', r.professional_id, 'demandes.waitlist', null,
          'slot:' || r.professional_id::text || ':' || v_day::text, pg_catalog.now() + interval '7 days');
      end if;
    end loop;
  end if;
  return v_n;
end;
$$;
revoke all on function private.demandes_capacity_snapshot(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The next one (D-35): a proposal ended without a placement (from *_demandes_propositions.sql)
-- -----------------------------------------------------------------------------
create or replace function private.demandes_end_proposition(p_org uuid, p_id uuid, p_response text, p_hold_reason text, p_actor uuid,
                                                 p_decline_reason text default null, p_keep_state boolean default false)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v public.demande_propositions;
  s jsonb;
begin
  select x.* into v from public.demande_propositions x where x.id = p_id and x.org_id = p_org for update;
  if v.id is null or v.response <> 'pending' then
    return false;
  end if;
  for s in select y.value from pg_catalog.jsonb_array_elements(v.slots) y loop
    perform private.appointments_release_hold(p_org, (s ->> 'appointment_id')::uuid, p_hold_reason);
  end loop;
  perform private.revoke_secure_links(p_org, 'proposition', 'demande_proposition', v.id, p_actor);
  update public.demande_propositions x
     set response = p_response, responded_at = pg_catalog.now(), decline_reason = p_decline_reason
   where x.id = v.id;
  if not p_keep_state then
    perform private.demandes_after_proposition(p_org, v.demande_id, p_actor);
  end if;
  -- D4 part 2 (D-35): her slot declined or unanswered while the person waits on the list — the
  -- next compatible registrant is to be offered it.
  if p_response in ('declined', 'expired')
     and exists (select 1 from public.waitlist_entries e where e.org_id = p_org and e.demande_id = v.demande_id and e.state <> 'closed')
     and exists (select 1 from private.demandes_waitlist_compatible(p_org, v.professional_id) c where c.demande_id <> v.demande_id) then
    perform private.notify(p_org, 'demandes', 'demandes.waitlist_offer_next', 'normal',
      'Plage à offrir au suivant',
      'La proposition à ' || coalesce((select f.display_name from private.professional_display_facts(p_org, v.professional_id) f), 'ce professionnel')
        || ' n''a pas placé la personne : offrez la plage à la personne suivante de la liste d''attente.',
      '/liste-attente?liste=p-' || v.professional_id, 'demande_proposition', v.id, 'demandes.waitlist', null,
      'next:' || v.id::text, pg_catalog.now() + interval '14 days');
  end if;
  return true;
end;
$$;
revoke all on function private.demandes_end_proposition(uuid, uuid, text, text, uuid, text, boolean) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
