-- =============================================================================
-- Demandes D4: the matching panel
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D4); docs/modules/professionals.md
--            « Ce que Demandes doit faire » (the 12 rules); research
--            docs/research/2026-10-08-intake-workbook.md §3
-- Decisions: D-27 … D-30 (this batch), R-66 (exclusions warn), P4-551 / P4-552 (refused motifs,
--            the priority), P4-382 / P4-387 (places left, computed here)
-- Needs:     Professionnels' `private.professional_matching_facts` (*_professionals_matching_exclusions.sql);
--            Clients' `private.clients_booking_facts`; Rendez-vous' `private.first_appointments`.
--
-- * `match_professionals_for_demande(demande)` (`demandes.view` and `professionals.view`, both
--   first): every professional of the clinic for the request, eligible ones first, each with why.
--   - Hard filters (D-27; a professional left out says why): active, ready, accepting new clients
--     (unless the client's first appointment is already with her), the profession asked, the
--     clientèle asked (or the age's, a couple's `couples`, a family's `families`), her youngest
--     age and « Femmes seulement », the language, the professional's gender when one is asked.
--   - Never a filter (warnings): a refused motif among the request's (R-66), the insurance
--     (« expirée » asks before proposing, « bientôt échue », « manquante »), an age or a sex the
--     limits need but nobody gave (« à vérifier »), 0 place left.
--   - The fit (D-28): the request's motifs she holds, then a ★ clientèle, then the request's
--     periods she has; the order is the fit, then places left (a number first, most first; then
--     « non suivi »; 0 last), then the name, then the id: documented and shown, never sort_order.
--   - « Bon à savoir », the priority (« À prioriser » and its reason: a badge, never the order,
--     D-29) and the directory's `updated_at` come along.
-- * `private.demandes_places_left(org, ids[] default null)` (D-30, rule 11): declared places −
--   the requests matched to her since she declared them whose client's first appointment is still
--   with her (a cancelled first appointment gives its place back); null when she tracks none.
--   Granted to no role (D5's snapshots and board read it too).
-- Additive: functions only.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_matching', true);

-- -----------------------------------------------------------------------------
-- Places left (rule 11)
-- -----------------------------------------------------------------------------
create function private.demandes_places_left(p_org uuid, p_ids uuid[] default null)
returns table (professional_id uuid, places_declared smallint, places_used int, places_left int, places_set_at timestamptz)
language sql
stable
set search_path = ''
as $$
  with pros as (
    select f.professional_id, f.new_client_places, f.new_client_places_set_at
      from private.professional_matching_facts(p_org, p_ids) f
  ),
  matched as (
    select d.matched_professional_id as professional_id, d.client_id
      from public.demandes d
      join pros p on p.professional_id = d.matched_professional_id
     where d.org_id = p_org and p.new_client_places is not null
       and d.matched_at >= coalesce(p.new_client_places_set_at, '-infinity'::timestamptz)
  ),
  firsts as (
    select a.client_id, a.professional_id
      from private.first_appointments(p_org, (select pg_catalog.array_agg(distinct m.client_id) from matched m where m.client_id is not null)) a
  ),
  used as (
    select m.professional_id, pg_catalog.count(*)::int as n
      from matched m
     where not public.module_enabled_for_org(p_org, 'appointments')
        or m.client_id is null
        or exists (select 1 from firsts x where x.client_id = m.client_id and x.professional_id = m.professional_id)
     group by m.professional_id
  )
  select p.professional_id, p.new_client_places,
         case when p.new_client_places is null then null else coalesce(u.n, 0) end,
         case when p.new_client_places is null then null else greatest(0, p.new_client_places - coalesce(u.n, 0)) end,
         p.new_client_places_set_at
    from pros p
    left join used u on u.professional_id = p.professional_id
$$;
revoke all on function private.demandes_places_left(uuid, uuid[]) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The match
-- -----------------------------------------------------------------------------
-- The request's criteria, as the panel reads them (and the job, later). Null for another clinic's.
create function private.demandes_match_criteria(p_org uuid, p_demande uuid)
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
  who as (
    select coalesce(pr.client_id, d.client_id) as client_id, pr.birthday as given_birthday
      from d left join principal pr on true
  ),
  facts as (
    select f.sex, f.birthday
      from who join private.clients_booking_facts(p_org, array[who.client_id]) f on f.found and not f.is_closed
     where who.client_id is not null
  )
  select pg_catalog.jsonb_build_object(
           'demande_id', d.id,
           'client_id', w.client_id,
           'language', d.language,
           'beneficiary', d.beneficiary,
           'profession_title_id', d.profession_title_id,
           'clientele_id', d.clientele_id,
           'preferred_pro_gender', d.preferred_pro_gender,
           'availability_periods', pg_catalog.to_jsonb(d.availability_periods),
           'motif_ids', coalesce((select pg_catalog.jsonb_agg(m.motif_id order by m.motif_id)
                                    from public.demande_motifs m join public.motifs_catalog c on c.id = m.motif_id
                                   where m.demande_id = d.id), '[]'),
           'sex', (select f.sex from facts f),
           'age', (select pg_catalog.date_part('year', pg_catalog.age(private.clinic_today_for_org(p_org),
                                                                       coalesce((select f.birthday from facts f), w.given_birthday)))::int
                    where coalesce((select f.birthday from facts f), w.given_birthday) is not null))
    from d cross join who w
$$;
revoke all on function private.demandes_match_criteria(uuid, uuid) from public, anon, authenticated, service_role;

-- Every professional of p_org for the criteria (or the ids given): eligible, why not, warnings,
-- the fit's parts, places left. Granted to no role.
create function private.demandes_match(p_org uuid, p_criteria jsonb, p_ids uuid[] default null)
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
    select a.professional_id from c, private.first_appointments(p_org, array[c.client_id]) a where c.client_id is not null
  ),
  f as (
    select x.*,
           -- The clientèles that fit: the one asked, else a couple's / a family's, else the age's.
           (select pg_catalog.array_agg(e) from pg_catalog.jsonb_array_elements(x.clienteles) e, c
             where case when c.clientele_id is not null then (e ->> 'id')::uuid = c.clientele_id
                        when c.beneficiary = 'couple' then e ->> 'key' = 'couples'
                        when c.beneficiary = 'family' then e ->> 'key' = 'families'
                        when c.age is not null then (e ->> 'min_age') is not null
                                                    and c.age >= (e ->> 'min_age')::int
                                                    and c.age <= coalesce((e ->> 'max_age')::int, 200)
                        else true end) as fitting
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
             case when (c.clientele_id is not null or c.beneficiary in ('couple', 'family') or c.age is not null)
                       and f.fitting is null then 'clientele' end,
             case when f.min_client_age is not null and c.age is not null and c.age < f.min_client_age then 'min_age' end,
             case when f.women_only and c.sex is not null and c.sex <> 'female' then 'women_only' end,
             case when not (c.language = any (f.language_codes)) then 'language' end,
             case when c.wanted_gender in ('female', 'male') and f.gender is distinct from c.wanted_gender then 'gender' end
           ], null) as why_not,
           array(select m from pg_catalog.unnest(c.motifs) m where m = any (f.motif_ids) order by m) as hits,
           array(select m from pg_catalog.unnest(c.motifs) m where m = any (f.refused_motif_ids) order by m) as refused,
           coalesce((select bool_or((e ->> 'specialized')::boolean) from pg_catalog.unnest(f.fitting) e), false)
             and (c.clientele_id is not null or c.beneficiary in ('couple', 'family') or c.age is not null) as star,
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
revoke all on function private.demandes_match(uuid, jsonb, uuid[]) from public, anon, authenticated, service_role;

-- The panel (D4): the request's criteria and every professional in the documented order, the
-- motifs named. `demandes.view` and `professionals.view` (« Bon à savoir » and the priority are
-- staff facts), both first.
create function public.match_professionals_for_demande(p_demande_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_criteria jsonb;
begin
  perform private.demandes_require('demandes.view');
  perform private.demandes_require('professionals.view');
  v_criteria := private.demandes_match_criteria(v_org, p_demande_id);
  if v_criteria is null then
    raise exception 'Cette demande n''existe pas.' using errcode = 'P0001', hint = 'demande_id';
  end if;
  return pg_catalog.jsonb_build_object(
    'criteria', v_criteria || pg_catalog.jsonb_build_object(
      'motifs', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', m.id, 'name', m.name) order by m.category_sort_order, m.sort_order, m.name)
                            from public.motifs_catalog m
                           where m.id in (select x::uuid from pg_catalog.jsonb_array_elements_text(v_criteria -> 'motif_ids') x)), '[]'),
      'profession_title_name', (select t.name from public.profession_titles_catalog t where t.id = (v_criteria ->> 'profession_title_id')::uuid),
      'clientele_name', (select k.name from public.clienteles_catalog k where k.id = (v_criteria ->> 'clientele_id')::uuid)),
    'professionals', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'professional_id', r.professional_id, 'display_name', r.display_name, 'title_label', r.title_label,
        'eligible', r.eligible, 'reasons', pg_catalog.to_jsonb(r.reasons), 'warnings', pg_catalog.to_jsonb(r.warnings),
        'motif_hits', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', m.id, 'name', m.name) order by m.category_sort_order, m.sort_order, m.name)
                                  from public.motifs_catalog m where m.id = any (r.motif_hits)), '[]'),
        'refused_hits', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', m.id, 'name', m.name) order by m.category_sort_order, m.sort_order, m.name)
                                    from public.motifs_catalog m where m.id = any (r.refused_hits)), '[]'),
        'specialized', r.specialized, 'period_hits', pg_catalog.to_jsonb(r.period_hits), 'fit', r.fit,
        'places_declared', r.places_declared, 'places_left', r.places_left, 'insurance_status', r.insurance_status,
        'matching_note', r.matching_note, 'priority_reason', r.priority_reason,
        'availability_periods', pg_catalog.to_jsonb(r.availability_periods), 'updated_at', r.updated_at, 'rank', r.sort_key)
        order by r.sort_key)
      from private.demandes_match(v_org, v_criteria) r), '[]'));
end;
$$;
revoke all on function public.match_professionals_for_demande(uuid) from public, anon;
grant execute on function public.match_professionals_for_demande(uuid) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
