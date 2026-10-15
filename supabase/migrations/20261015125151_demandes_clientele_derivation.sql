-- =============================================================================
-- Demandes: the clientèle « Automatique » (Jonathan, 2026-10-15, D-59, révisable)
-- =============================================================================
-- The intake's « Clientèle » was a free choice beside what the participants already say. The match
-- (D4) derives it when empty: the clientèle asked, else a couple's `couples`, a family's
-- `families`, else the clientèles whose ages hold the person's age (the main participant's file or
-- birthday, else the request's file). That rule now lives in one predicate,
-- `private.demandes_clientele_holds(clientele asked, beneficiary, age, a clientèle's id, key, ages)`,
-- and every reader uses it:
-- * `private.demandes_match` (the panel, « Prochaine disponibilité », the waiting list's compatible
--   registrants), on each of the professional's clientèles, as before (no basis: nothing checked);
-- * `private.demandes_clientele_fit(org, clientele, beneficiary, age)` → `{ basis, clienteles }`
--   (`basis`: chosen, couple, family, age, none), on Professionnels' active catalogue;
-- * `private.demandes_match_criteria` adds `person` (participant | file | null: whose age and sex),
--   `clientele_auto` (the derivation without the choice) and `clientele_fit` (as applied);
-- * `get_demande` adds `match_basis` { person, age, clientele_auto, derivable_ids }: the Accueil field shows
--   « Automatique : Enfants (participant principal, 9 ans) » from the server, never from a second
--   copy of the rule in the browser.
-- Stored values are unchanged: `clientele_id` null still means « derived ».
-- Same signatures and grants.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_clientele_derivation', true);

-- The one rule (D4): does a clientèle (its id, key and ages) hold the request's people? The one
-- asked, else a couple's `couples`, a family's `families`, else one whose ages hold the age; with
-- no basis, every clientèle does (nothing is checked). Immutable SQL: inlined where it is used.
create function private.demandes_clientele_holds(p_clientele_id uuid, p_beneficiary text, p_age int,
                                                 p_id uuid, p_key text, p_min_age int, p_max_age int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_clientele_id is not null then p_id = p_clientele_id
              when p_beneficiary = 'couple' then p_key = 'couples'
              when p_beneficiary = 'family' then p_key = 'families'
              when p_age is not null then p_min_age is not null and p_age >= p_min_age and p_age <= coalesce(p_max_age, 200)
              else true end
$$;
revoke all on function private.demandes_clientele_holds(uuid, text, int, uuid, text, int, int) from public, anon, authenticated, service_role;

-- What the rule gives for a request: its basis (chosen, couple, family, age, none) and the active
-- clientèles of Professionnels' catalogue that hold (none for `none`). Granted to no role: for the
-- definer readers above, after their permission checks.
create function private.demandes_clientele_fit(p_org uuid, p_clientele_id uuid, p_beneficiary text, p_age int)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with b as (
    select case when p_clientele_id is not null then 'chosen'
                when p_beneficiary = 'couple' then 'couple'
                when p_beneficiary = 'family' then 'family'
                when p_age is not null then 'age'
                else 'none' end as basis
  )
  select pg_catalog.jsonb_build_object(
           'basis', b.basis,
           'clienteles', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', k.id, 'key', k.key, 'name', k.name)
                                         order by k.sort_order, k.name)
               from public.clienteles_catalog k
              where k.org_id = p_org and b.basis <> 'none'
                and private.demandes_clientele_holds(p_clientele_id, p_beneficiary, p_age, k.id, k.key, k.min_age, k.max_age)), '[]'::jsonb))
    from b
$$;
revoke all on function private.demandes_clientele_fit(uuid, uuid, text, int) from public, anon, authenticated, service_role;

-- The criteria: whose age, the clientèle derived (otherwise as 20261013181604).
create or replace function private.demandes_match_criteria(p_org uuid, p_demande uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with d as (
    select x.* from public.demandes x where x.org_id = p_org and x.id = p_demande
  ),
  principal as (
    select p.client_id, p.birthday
      from public.demande_participants p join d on d.id = p.demande_id
     order by p.is_primary desc, p.created_at
     limit 1
  ),
  -- The person seen: the main participant when the request has participants (her file, else the
  -- birthday given), never the caller's file in her place; the request's file otherwise.
  who as (
    select case when exists (select 1 from principal) then pr.client_id else d.client_id end as client_id,
           pr.birthday as given_birthday
      from d left join principal pr on true
  ),
  facts as (
    select f.sex, f.birthday
      from who join private.clients_booking_facts(p_org, array[who.client_id]) f on f.found and not f.is_closed
     where who.client_id is not null
  ),
  base as (
  select pg_catalog.jsonb_build_object(
           'demande_id', d.id,
           'client_id', w.client_id,
           'language', d.language,
           'beneficiary', d.beneficiary,
           -- An archived profession or clientèle is not applied (it would leave everyone out): said so.
           'profession_title_id', (select t.id from public.profession_titles_catalog t where t.org_id = p_org and t.id = d.profession_title_id),
           'clientele_id', (select k.id from public.clienteles_catalog k where k.org_id = p_org and k.id = d.clientele_id),
           'ignored', pg_catalog.to_jsonb(array_remove(array[
             case when d.profession_title_id is not null
                   and not exists (select 1 from public.profession_titles_catalog t where t.org_id = p_org and t.id = d.profession_title_id)
                  then 'profession' end,
             case when d.clientele_id is not null
                   and not exists (select 1 from public.clienteles_catalog k where k.org_id = p_org and k.id = d.clientele_id)
                  then 'clientele' end], null)),
           'preferred_pro_gender', d.preferred_pro_gender,
           'availability_periods', pg_catalog.to_jsonb(d.availability_periods),
           'motif_ids', coalesce((select pg_catalog.jsonb_agg(m.motif_id order by m.motif_id)
                                    from public.demande_motifs m join public.motifs_catalog c on c.org_id = p_org and c.id = m.motif_id
                                   where m.demande_id = d.id), '[]'),
           'sex', (select f.sex from facts f),
           'age', (select pg_catalog.date_part('year', pg_catalog.age(private.clinic_today_for_org(p_org),
                                                                       coalesce((select f.birthday from facts f), w.given_birthday)))::int
                    where coalesce((select f.birthday from facts f), w.given_birthday) is not null))
           as j,
           exists (select 1 from principal) as from_participant,
           d.client_id as demande_client_id
    from d cross join who w
  )
  select b.j || pg_catalog.jsonb_build_object(
           -- Whose age and sex: the main participant when there are participants, else the request's file.
           'person', case when b.from_participant then 'participant' when b.demande_client_id is not null then 'file' end,
           -- The clientèle the request's people give (« Automatique »), and the one applied (a choice wins).
           'clientele_auto', private.demandes_clientele_fit(p_org, null, b.j ->> 'beneficiary', (b.j ->> 'age')::int),
           'clientele_fit', private.demandes_clientele_fit(p_org, (b.j ->> 'clientele_id')::uuid, b.j ->> 'beneficiary', (b.j ->> 'age')::int))
    from base b
$$;

create or replace function private.demandes_match(p_org uuid, p_criteria jsonb, p_ids uuid[] default null)
returns table (
  professional_id uuid, display_name text, title_label text, eligible boolean, reasons text[], warnings text[],
  motif_hits uuid[], refused_hits uuid[], specialized boolean, period_hits text[], fit int,
  places_declared smallint, places_left int, insurance_status text, matching_note text, priority_reason text,
  availability_periods text[], updated_at timestamptz, sort_key int
)
language sql
stable
set search_path = ''
as $$
  with c as (
    select p_criteria as j,
           p_criteria ->> 'language' as language,
           p_criteria ->> 'beneficiary' as beneficiary,
           nullif(p_criteria ->> 'profession_title_id', '')::uuid as title_id,
           nullif(p_criteria ->> 'clientele_id', '')::uuid as clientele_id,
           coalesce(p_criteria ->> 'preferred_pro_gender', 'any') as wanted_gender,
           (p_criteria ->> 'age')::int as age,
           p_criteria ->> 'sex' as sex,
           coalesce((select pg_catalog.array_agg(x::uuid) from pg_catalog.jsonb_array_elements_text(p_criteria -> 'motif_ids') x), '{}') as motifs,
           coalesce((select pg_catalog.array_agg(x) from pg_catalog.jsonb_array_elements_text(p_criteria -> 'availability_periods') x), '{}') as periods,
           nullif(p_criteria ->> 'client_id', '')::uuid as client_id
  ),
  first_with as (
    select a.professional_id from c, private.first_appointments(p_org, array[c.client_id]) a
     where c.client_id is not null and public.module_enabled_for_org(p_org, 'appointments')
  ),
  f as (
    select x.*,
           -- The clientèles that fit: the one asked, else a couple's / a family's, else the age's
           -- (`private.demandes_clientele_holds`, the record's « Automatique » too); no basis: all.
           (select pg_catalog.array_agg(e) from pg_catalog.jsonb_array_elements(x.clienteles) e, c
             where private.demandes_clientele_holds(c.clientele_id, c.beneficiary, c.age, (e ->> 'id')::uuid, e ->> 'key',
                                                    (e ->> 'min_age')::int, (e ->> 'max_age')::int)) as fitting
      from private.professional_matching_facts(p_org, p_ids) x
  ),
  scored as (
    select f.*, c.*,
           array_remove(array[
             case when f.status <> 'active' then 'inactive' end,
             case when not f.ready then 'not_ready' end,
             case when not f.accepting_new_clients and not exists (select 1 from first_with w where w.professional_id = f.professional_id)
                  then 'not_accepting' end,
             case when c.title_id is not null and not (c.title_id = any (f.title_ids)) then 'title' end,
             case when (c.clientele_id is not null or coalesce(c.beneficiary, '') in ('couple', 'family') or c.age is not null)
                       and f.fitting is null then 'clientele' end,
             case when f.min_client_age is not null and c.age is not null and c.age < f.min_client_age then 'min_age' end,
             case when f.women_only and c.sex is not null and c.sex <> 'female' then 'women_only' end,
             case when not (c.language = any (f.language_codes)) then 'language' end,
             case when c.wanted_gender in ('female', 'male') and f.gender is distinct from c.wanted_gender then 'gender' end
           ], null) as why_not,
           array(select m from pg_catalog.unnest(c.motifs) m where m = any (f.motif_ids) order by m) as hits,
           array(select m from pg_catalog.unnest(c.motifs) m where m = any (f.refused_motif_ids) order by m) as refused,
           coalesce((select bool_or((e ->> 'specialized')::boolean) from pg_catalog.unnest(f.fitting) e), false)
             and (c.clientele_id is not null or coalesce(c.beneficiary, '') in ('couple', 'family') or c.age is not null) as star,
           array(select p from pg_catalog.unnest(array['am', 'pm', 'end_of_day', 'evening', 'weekend']) with ordinality as o(p, n)
                  where p = any (c.periods) and p = any (f.availability_periods) order by o.n) as periods_hit
      from f cross join c
  )
  select s.professional_id, s.display_name, s.primary_title_label,
         pg_catalog.cardinality(s.why_not) = 0,
         s.why_not,
         array_remove(array[
           case when pg_catalog.cardinality(s.refused) > 0 then 'refused_motif' end,
           case s.insurance_status when 'expired' then 'insurance_expired' when 'expiring' then 'insurance_expiring'
                                   when 'missing' then 'insurance_missing' end,
           case when s.min_client_age is not null and s.age is null then 'age_unknown' end,
           -- No age, no clientèle asked, neither a couple nor a family: the clientèle is not checked.
           case when s.age is null and s.clientele_id is null and coalesce(s.beneficiary, '') not in ('couple', 'family')
                then 'clientele_unknown' end,
           case when s.women_only and s.sex is null then 'sex_unknown' end,
           case when pl.places_left = 0 then 'no_places' end
         ], null),
         s.hits, s.refused, s.star, s.periods_hit,
         pg_catalog.cardinality(s.hits) * 100 + case when s.star then 10 else 0 end + pg_catalog.cardinality(s.periods_hit),
         pl.places_declared, pl.places_left, s.insurance_status, s.matching_note, s.matching_priority_reason,
         s.availability_periods, s.updated_at,
         (pg_catalog.row_number() over (
            order by pg_catalog.cardinality(s.why_not) = 0 desc,
                     pg_catalog.cardinality(s.hits) * 100 + case when s.star then 10 else 0 end + pg_catalog.cardinality(s.periods_hit) desc,
                     coalesce(pl.places_left::numeric, 0.5) desc,
                     s.display_name, s.professional_id))::int
    from scored s
    left join private.demandes_places_left(p_org, p_ids) pl on pl.professional_id = s.professional_id
$$;

-- get_demande: the match's basis (otherwise as 20261013062727).
create or replace function public.get_demande(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.demandes;
  v_inbox record;
  v_notes boolean;
  v_criteria jsonb;
begin
  perform private.demandes_require('demandes.view');
  select * into v_row from public.demandes d where d.id = p_id and d.org_id = v_org;
  if v_row.id is null then
    return null;
  end if;
  select * into v_inbox from private.demandes_inbox_rows(v_org, null, v_row.id) r;
  v_notes := private.has_permission('demandes.notes');
  v_criteria := private.demandes_match_criteria(v_org, v_row.id);
  return jsonb_build_object(
    'demande', to_jsonb(v_row) - 'handled_by' - 'handled_at' - 'reference_year' - 'reference_seq'
               || jsonb_build_object(
                    'handled_by', v_inbox.handled_by, 'handled_by_name', v_inbox.handled_by_name, 'handled_at', v_inbox.handled_at,
                    'assigned_name', v_inbox.assigned_name,
                    'received_by_name', (select p.display_name from public.profiles p where p.user_id = v_row.received_by),
                    'waiting_hours', v_inbox.waiting_hours, 'promise', v_inbox.promise, 'no_answer', v_inbox.no_answer,
                    'first_contact_at', v_inbox.first_contact_at, 'last_outcome', v_inbox.last_outcome,
                    'person_name', v_inbox.person_name),
    'client', (select jsonb_build_object('id', c.id, 'client_number', c.client_number, 'display_name', c.display_name,
                                         'email', c.email, 'mobile_e164', c.mobile_e164, 'birthday', c.birthday,
                                         'is_archived', c.is_archived)
                 from public.clients_directory c where c.id = v_row.client_id),
    'matched_professional', (select jsonb_build_object('id', p.id, 'display_name', p.display_name)
                               from public.professionals_directory p where p.id = v_row.matched_professional_id),
    'motif_ids', coalesce((select jsonb_agg(m.motif_id order by m.motif_id) from public.demande_motifs m where m.demande_id = v_row.id), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', p.id, 'client_id', p.client_id, 'display_name', p.display_name,
                                'relationship', p.relationship, 'birthday', p.birthday, 'is_primary', p.is_primary,
                                'client', (select jsonb_build_object('client_number', c.client_number, 'display_name', c.display_name)
                                             from public.clients_directory c where c.id = p.client_id))
                                order by p.is_primary desc, p.created_at, p.id)
                                from public.demande_participants p where p.demande_id = v_row.id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', k.id, 'kind', k.kind, 'due_at', k.due_at, 'state', k.state, 'outcome', k.outcome,
                         'assigned_to', k.assigned_to,
                         'assigned_name', (select p.display_name from public.profiles p where p.user_id = k.assigned_to),
                         'done_at', k.done_at,
                         'done_by_name', (select p.display_name from public.profiles p where p.user_id = k.done_by))
                         order by (k.state = 'open') desc, k.due_at, k.id)
                         from public.demande_tasks k where k.demande_id = v_row.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', e.id, 'kind', e.kind, 'from_state', e.from_state, 'to_state', e.to_state,
                          'closed_reason', e.closed_reason, 'contact_channel', e.contact_channel,
                          'contact_outcome', e.contact_outcome,
                          'professional_name', (select p.display_name from public.professionals_directory p where p.id = e.professional_id),
                          'assignee_name', (select p.display_name from public.profiles p where p.user_id = e.assignee),
                          'at', e.at,
                          'by_name', (select p.display_name from public.profiles p where p.user_id = e.by_user))
                          order by e.at desc, e.id desc)
                          from public.demande_events e where e.demande_id = v_row.id), '[]'::jsonb),
    'note', case when v_notes then
              (select jsonb_build_object('internal_note', n.internal_note, 'updated_at', n.updated_at,
                                         'updated_by_name', (select p.display_name from public.profiles p where p.user_id = n.updated_by))
                 from public.demande_notes n where n.demande_id = v_row.id)
            end,
    'can', jsonb_build_object('manage', private.has_permission('demandes.manage'), 'notes', v_notes),
    'match_basis', jsonb_build_object('person', v_criteria -> 'person', 'age', v_criteria -> 'age',
                                      'clientele_auto', v_criteria -> 'clientele_auto',
                                      -- The clientèles the rule can give (ages, couples, families): a choice
                                      -- among them that the people contradict is worth a warning; « Parents »
                                      -- or « Athlètes » never are.
                                      'derivable_ids', coalesce((select jsonb_agg(k.id order by k.sort_order)
                                                                   from public.clienteles_catalog k
                                                                  where k.org_id = v_org
                                                                    and (k.min_age is not null or k.key in ('couples', 'families'))), '[]'::jsonb))
  );
end;
$$;
