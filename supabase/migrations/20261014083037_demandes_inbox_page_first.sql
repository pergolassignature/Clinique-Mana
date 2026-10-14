-- Demandes: the inbox reads its page first (the volume test, docs/plans/2026-10-14-volume-test.md).
--
-- `list_demandes` read every request of the view through `private.demandes_inbox_rows`, which
-- computes each one's business-hours delay, then filtered, sorted and kept 50. Over every request
-- (`all`, ~4 000 at the cutover) that cost 74 ms, 93 ms with a search. Now, when neither the
-- filters nor the order need the delay (no « En retard » flag, not « Attente la plus longue », not
-- the open view's priority order), the page is chosen on the request's own columns (the view, the
-- counselor, urgent, « Sans réponse », « À rappeler maintenant », the search), and the delays are
-- computed for its rows only. The other cases keep the full read: the open view is a few hundred
-- requests, and its order needs the delay. Same rows, same order, same values: pgTAP 198 compares
-- both on a volume-shaped set.
--
-- `private.demandes_inbox_rows` gains `p_ids` (the page's requests, read at once; its callers by
-- states or by one request are unchanged). `list_demandes` replaced with the same signature and grants.

-- -----------------------------------------------------------------------------
-- The inbox's rows: also for a list of requests (`p_ids`, the page), in one read. Same body
-- otherwise (*_demandes_inbox.sql); the calls by states or by one request are unchanged.
-- -----------------------------------------------------------------------------
drop function private.demandes_inbox_rows(uuid, text[], uuid);

create function private.demandes_inbox_rows(p_org uuid, p_states text[] default null, p_id uuid default null, p_ids uuid[] default null)
returns table (
  id uuid, reference text, received_at timestamptz, channel text, state text, is_urgent boolean,
  client_id uuid, client_number int, person_name text, beneficiary text,
  assigned_to uuid, assigned_name text, contact_attempts int, last_contact_at timestamptz,
  last_outcome text, next_contact_at timestamptz, first_contact_at timestamptz,
  waiting_hours numeric, promise text, no_answer boolean,
  handled_by uuid, handled_by_name text, handled_at timestamptz,
  open_tasks int, next_task_due timestamptz, motif_count int,
  search_text text, phone_digits text[]
)
language sql
stable
set search_path = ''
as $$
  with tz as (select coalesce(o.timezone, 'America/Toronto') as tz from public.organizations o where o.id = p_org)
  select d.id, d.reference, d.received_at, d.channel, d.state, d.is_urgent,
         d.client_id, c.client_number, coalesce(c.display_name, d.contact_name, d.contact_email, d.contact_phone_e164),
         d.beneficiary, d.assigned_to, pa.display_name, d.contact_attempts, d.last_contact_at,
         lc.contact_outcome, d.next_contact_at, fc.at,
         h.hours,
         case when fc.at is null and not h.open then 'none' else private.demandes_promise(h.hours, fc.at is not null) end,
         h.open and lc.contact_outcome is not null and lc.contact_outcome <> 'reached',
         case when d.handled_at > pg_catalog.now() - private.demandes_handling_window() then d.handled_by end,
         case when d.handled_at > pg_catalog.now() - private.demandes_handling_window() then ph.display_name end,
         case when d.handled_at > pg_catalog.now() - private.demandes_handling_window() then d.handled_at end,
         coalesce(t.open_tasks, 0), t.next_due,
         (select count(*)::int from public.demande_motifs m where m.org_id = d.org_id and m.demande_id = d.id),
         private.demandes_fold(concat_ws(' ', d.reference, c.display_name, d.contact_name, d.contact_email, c.email)),
         array_remove(array[pg_catalog.regexp_replace(coalesce(d.contact_phone_e164, ''), '[^0-9]', '', 'g'),
                            pg_catalog.regexp_replace(coalesce(c.mobile_e164, ''), '[^0-9]', '', 'g')], '')
    from public.demandes d
    left join public.clients_directory c on c.id = d.client_id
    left join public.profiles pa on pa.user_id = d.assigned_to
    left join public.profiles ph on ph.user_id = d.handled_by
    left join lateral (select e.contact_outcome from public.demande_events e
                        where e.org_id = d.org_id and e.demande_id = d.id and e.contact_channel is not null
                        order by e.at desc, e.id desc limit 1) lc on true
    left join lateral (select min(e.at) as at from public.demande_events e
                        where e.org_id = d.org_id and e.demande_id = d.id and e.contact_channel is not null) fc on true
    left join lateral (select count(*)::int as open_tasks, min(k.due_at) as next_due from public.demande_tasks k
                        where k.org_id = d.org_id and k.demande_id = d.id and k.state = 'open') t on true
    cross join lateral (
      select d.state not in ('matched', 'closed') as open,
             case when fc.at is null and d.state in ('matched', 'closed') then 0::numeric(10, 1)
                  else private.demandes_business_hours(d.received_at, coalesce(fc.at, pg_catalog.now()), (select tz from tz)) end as hours
    ) h
   where d.org_id = p_org
     and (p_states is null or d.state = any (p_states))
     and (p_id is null or d.id = p_id)
     and (p_ids is null or d.id = any (p_ids))
$$;
revoke all on function private.demandes_inbox_rows(uuid, text[], uuid, uuid[]) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The inbox
-- -----------------------------------------------------------------------------
create or replace function public.list_demandes(
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
  v_states text[] := case p_view when 'open' then array['new', 'evaluating', 'accepted', 'proposed'] when 'all' then null else array[p_view] end;
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform private.demandes_require('demandes.view');
  if p_view not in ('open', 'matched', 'waitlist', 'closed', 'all') or p_assigned not in ('me', 'none', 'any')
     or not (coalesce(p_flags, '{}') <@ array['late', 'no_answer', 'urgent', 'due'])
     or v_sort not in ('priority', 'received_desc', 'received_asc', 'waiting_desc', 'state') then
    raise exception 'Unknown filter' using errcode = '22023';
  end if;

  -- The page first: nothing below needs the delay.
  if p_flags is not null and not ('late' = any (p_flags)) and v_sort <> 'waiting_desc'
     and not (v_sort = 'priority' and p_view = 'open') then
    return query
      with page as (
        select d.id as demande_id,
               pg_catalog.row_number() over (
                 order by case when v_sort = 'received_asc' then d.received_at end asc,
                          case when v_sort = 'state' then pg_catalog.array_position(
                                 array['new', 'evaluating', 'accepted', 'proposed', 'waitlist', 'matched', 'closed'], d.state) end asc,
                          d.received_at desc, d.id) as n
          from public.demandes d
         where d.org_id = v_org
           and (v_states is null or d.state = any (v_states))
           and case p_assigned when 'me' then d.assigned_to = v_me when 'none' then d.assigned_to is null else true end
           and (not ('urgent' = any (p_flags)) or d.is_urgent)
           -- « Sans réponse »: open, and the last contact attempt did not reach the person.
           and (not ('no_answer' = any (p_flags))
                or (d.state not in ('matched', 'closed')
                    and coalesce((select e.contact_outcome <> 'reached' from public.demande_events e
                                   where e.org_id = d.org_id and e.demande_id = d.id and e.contact_channel is not null
                                   order by e.at desc, e.id desc limit 1), false)))
           -- « À rappeler maintenant »: the next try, or an open task, due.
           and (not ('due' = any (p_flags))
                or d.next_contact_at <= pg_catalog.now()
                or exists (select 1 from public.demande_tasks k
                            where k.org_id = d.org_id and k.demande_id = d.id and k.state = 'open' and k.due_at <= pg_catalog.now()))
           -- The search: the same text and phones as `demandes_inbox_rows`.
           and (v_search is null
                or (select pg_catalog.strpos(private.demandes_fold(concat_ws(' ', d.reference, c.display_name, d.contact_name,
                                                                            d.contact_email, c.email)), v_search) > 0
                           or (pg_catalog.length(v_digits) >= 4 and exists (
                                 select 1 from unnest(array_remove(array[
                                   pg_catalog.regexp_replace(coalesce(d.contact_phone_e164, ''), '[^0-9]', '', 'g'),
                                   pg_catalog.regexp_replace(coalesce(c.mobile_e164, ''), '[^0-9]', '', 'g')], '')) p
                                  where pg_catalog.strpos(p, v_digits) > 0))
                      from (select 1) one
                      left join public.clients_directory c on c.id = d.client_id))
         order by n
        offset v_offset
         limit v_limit
      )
      select r.id, r.reference, r.received_at, r.channel, r.state, r.is_urgent, r.client_id, r.client_number, r.person_name,
             r.beneficiary, r.assigned_to, r.assigned_name, r.contact_attempts, r.last_contact_at, r.last_outcome,
             r.next_contact_at, r.first_contact_at, r.waiting_hours, r.promise, r.no_answer,
             r.handled_by, r.handled_by_name, r.handled_at, r.open_tasks, r.next_task_due, r.motif_count
        from page p
        join private.demandes_inbox_rows(v_org, null, null, (select coalesce(array_agg(x.demande_id), '{}') from page x)) r on r.id = p.demande_id
       order by p.n;
    return;
  end if;

  -- The full read: the filters or the order need every request's delay.
  return query
    select r.id, r.reference, r.received_at, r.channel, r.state, r.is_urgent, r.client_id, r.client_number, r.person_name,
           r.beneficiary, r.assigned_to, r.assigned_name, r.contact_attempts, r.last_contact_at, r.last_outcome,
           r.next_contact_at, r.first_contact_at, r.waiting_hours, r.promise, r.no_answer,
           r.handled_by, r.handled_by_name, r.handled_at, r.open_tasks, r.next_task_due, r.motif_count
      from private.demandes_inbox_rows(v_org, v_states) r
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
     offset v_offset
     limit v_limit;
end;
$$;
revoke all on function public.list_demandes(text, text, text[], text, int, int, text) from public, anon, authenticated;
grant execute on function public.list_demandes(text, text, text[], text, int, int, text) to authenticated;
