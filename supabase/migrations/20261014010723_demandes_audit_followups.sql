-- =============================================================================
-- Demandes: the parity audit's after-cutover items (A-1, A-4, A-7)
-- =============================================================================
-- Audit:     docs/plans/2026-10-13-parity-audit.md L18 (A-1), L17 for Demandes (A-4), L20 (A-7)
-- Legacy:    docs/plans/2026-10-06-legacy-feature-inventory.md §C (list: sort, columns)
-- Decisions: D-46 … D-48 (decisions log)
--
-- * A-1 (D-46) `list_client_demandes(p_client_id)` (demandes.view): the requests of a client file,
--   hers (the request's file) or as a participant, newest first: number, received, state and
--   closing reason, her role, the matched professional's name. For Clients' record tab « Demandes »
--   (the slot `client.demandes`).
-- * A-4 (D-47) `list_demandes` gains `p_sort`: `priority` (the inbox's order: urgent, late, then
--   the oldest for the open views, the newest otherwise), `received_desc`, `received_asc`,
--   `waiting_desc` (waited the longest first), `state`. Replaced (dropped and created with the new
--   argument last, defaulted): a call without it reads as before.
-- * A-7 (D-48) `demande_next_slots(p_demande_id)` (demandes.view, professionals.view,
--   appointments.view): for the request's eligible professionals (the matching panel's order, the
--   first 15), her default service for this request (`private.demandes_default_service`: a
--   couple's service for a couple, else the 50-minute session, else her first) and her next free
--   slot in the coming 4 weeks (Rendez-vous' `get_open_slots`). One professional's refusal (no
--   bookable service) leaves her out, never the whole answer.
-- Additive: functions; `list_demandes` replaced with a compatible signature.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_audit_followups', true);

-- -----------------------------------------------------------------------------
-- A-1: a client file's requests
-- -----------------------------------------------------------------------------
create function public.list_client_demandes(p_client_id uuid)
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
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', d.id, 'reference', d.reference, 'received_at', d.received_at, 'state', d.state,
             'closed_reason', d.closed_reason, 'beneficiary', d.beneficiary,
             'role', case when d.client_id = p_client_id then 'file' else 'participant' end,
             'matched_professional_name', (select n.display_name from private.professional_display_names(v_org, array[d.matched_professional_id]) n))
           order by d.received_at desc, d.id)
      from public.demandes d
     where d.org_id = v_org
       and (d.client_id = p_client_id
            or exists (select 1 from public.demande_participants p
                        where p.org_id = v_org and p.demande_id = d.id and p.client_id = p_client_id))), '[]');
end;
$$;
revoke all on function public.list_client_demandes(uuid) from public, anon, authenticated;
grant execute on function public.list_client_demandes(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- A-4: the inbox's sort
-- -----------------------------------------------------------------------------
drop function public.list_demandes(text, text, text[], text, int, int);

-- p_view: `open` (new, evaluating, accepted, proposed), `matched`, `waitlist`, `closed`, `all`.
-- p_assigned: `me`, `none`, `any`. p_flags (all must hold): `late` (the promise broken),
-- `no_answer` (« sans réponse »), `urgent`, `due` (a callback or a task due now).
-- p_search: the number, a name, an email (accents ignored) or 4+ digits of a phone.
-- p_sort (D-47): `priority` (open views: urgent first, then late, then the oldest; the others:
-- the newest first), `received_desc`, `received_asc`, `waiting_desc`, `state` (the states' order,
-- then the newest).
create function public.list_demandes(
  p_view text default 'open',
  p_assigned text default 'any',
  p_flags text[] default '{}',
  p_search text default null,
  p_offset int default 0,
  p_limit int default 50,
  p_sort text default 'priority'
)
returns table (
  id uuid, reference text, received_at timestamptz, channel text, state text, is_urgent boolean,
  client_id uuid, client_number int, person_name text, beneficiary text,
  assigned_to uuid, assigned_name text, contact_attempts int, last_contact_at timestamptz,
  last_outcome text, next_contact_at timestamptz, first_contact_at timestamptz,
  waiting_hours numeric, promise text, no_answer boolean,
  handled_by uuid, handled_by_name text, handled_at timestamptz,
  open_tasks int, next_task_due timestamptz, motif_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_me uuid := auth.uid();
  v_search text := nullif(private.demandes_fold(pg_catalog.btrim(pg_catalog.left(p_search, 100))), '');
  v_digits text := nullif(pg_catalog.regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
  v_sort text := coalesce(p_sort, 'priority');
begin
  perform private.demandes_require('demandes.view');
  if p_view not in ('open', 'matched', 'waitlist', 'closed', 'all') or p_assigned not in ('me', 'none', 'any')
     or not (coalesce(p_flags, '{}') <@ array['late', 'no_answer', 'urgent', 'due'])
     or v_sort not in ('priority', 'received_desc', 'received_asc', 'waiting_desc', 'state') then
    raise exception 'Unknown filter' using errcode = '22023';
  end if;
  return query
    select r.id, r.reference, r.received_at, r.channel, r.state, r.is_urgent, r.client_id, r.client_number, r.person_name,
           r.beneficiary, r.assigned_to, r.assigned_name, r.contact_attempts, r.last_contact_at, r.last_outcome,
           r.next_contact_at, r.first_contact_at, r.waiting_hours, r.promise, r.no_answer,
           r.handled_by, r.handled_by_name, r.handled_at, r.open_tasks, r.next_task_due, r.motif_count
      from private.demandes_inbox_rows(v_org,
             case p_view when 'open' then array['new', 'evaluating', 'accepted', 'proposed'] when 'all' then null else array[p_view] end) r
     where case p_assigned when 'me' then r.assigned_to = v_me when 'none' then r.assigned_to is null else true end
       and (not ('late' = any (p_flags)) or r.promise = 'late')
       and (not ('no_answer' = any (p_flags)) or r.no_answer)
       and (not ('urgent' = any (p_flags)) or r.is_urgent)
       and (not ('due' = any (p_flags)) or r.next_contact_at <= pg_catalog.now() or r.next_task_due <= pg_catalog.now())
       and (v_search is null or pg_catalog.strpos(r.search_text, v_search) > 0
            or (pg_catalog.length(v_digits) >= 4 and exists (select 1 from unnest(r.phone_digits) p where pg_catalog.strpos(p, v_digits) > 0)))
     order by case when v_sort = 'priority' and p_view = 'open' then r.is_urgent end desc nulls last,
              case when v_sort = 'priority' and p_view = 'open' then r.promise = 'late' end desc nulls last,
              case when v_sort = 'priority' and p_view = 'open' then r.received_at end asc,
              case when v_sort = 'received_asc' then r.received_at end asc,
              case when v_sort = 'waiting_desc' then r.waiting_hours end desc nulls last,
              case when v_sort = 'state' then pg_catalog.array_position(
                     array['new', 'evaluating', 'accepted', 'proposed', 'waitlist', 'matched', 'closed'], r.state) end asc,
              r.received_at desc, r.id
     offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;
revoke all on function public.list_demandes(text, text, text[], text, int, int, text) from public, anon, authenticated;
grant execute on function public.list_demandes(text, text, text[], text, int, int, text) to authenticated;

-- -----------------------------------------------------------------------------
-- A-7: the next free slot of the eligible professionals
-- -----------------------------------------------------------------------------
-- Her default service for a request (D-48): one of her titles' sessions (or a clinic session)
-- with a length; a couple's service for a couple, else the 50-minute session, else the shortest
-- code. Null when she has none.
create function private.demandes_default_service(p_org uuid, p_professional_id uuid, p_for_two boolean)
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
   order by (s.for_two = coalesce(p_for_two, false)) desc, (s.duration_minutes = 50) desc, s.code
   limit 1
$$;
revoke all on function private.demandes_default_service(uuid, uuid, boolean) from public, anon, authenticated, service_role;

create function public.demande_next_slots(p_demande_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_criteria jsonb;
  v_for_two boolean;
  v_today date;
  v_service uuid;
  v_start timestamptz;
  v_result jsonb := '[]';
  r record;
begin
  perform private.demandes_require('demandes.view');
  perform private.demandes_require('professionals.view');
  perform private.demandes_require('appointments.view');
  v_criteria := private.demandes_match_criteria(v_org, p_demande_id);
  if v_criteria is null then
    raise exception 'Cette demande n''existe pas.' using errcode = 'P0001', hint = 'demande_id';
  end if;
  v_for_two := (select d.beneficiary = 'couple' from public.demandes d where d.org_id = v_org and d.id = p_demande_id);
  v_today := (pg_catalog.now() at time zone coalesce((select o.timezone from public.organizations o where o.id = v_org), 'America/Toronto'))::date;
  for r in select m.professional_id from private.demandes_match(v_org, v_criteria) m
            where m.eligible order by m.sort_key limit 15 loop
    v_service := private.demandes_default_service(v_org, r.professional_id, v_for_two);
    continue when v_service is null;
    begin
      select pg_catalog.min(s.starts_at) into v_start
        from public.get_open_slots(r.professional_id, v_service, v_today, v_today + 27) s
       where s.starts_at > pg_catalog.now();
    exception when sqlstate 'P0001' then
      continue;
    end;
    v_result := v_result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'professional_id', r.professional_id, 'service_id', v_service,
      'service_name', (select s.name from public.services_catalog s where s.org_id = v_org and s.id = v_service),
      'starts_at', v_start));
  end loop;
  return v_result;
end;
$$;
revoke all on function public.demande_next_slots(uuid) from public, anon, authenticated;
grant execute on function public.demande_next_slots(uuid) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
