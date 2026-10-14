-- =============================================================================
-- Rapports: « Indicateurs des demandes » — the intake indicators (Demandes batch D6, RP2's intake part)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D6), §12 (RP2)
-- Data:      docs/research/2026-10-08-intake-workbook.md §8.3 (the workbook's KPIs, defined once)
-- Decisions: D-42 … D-45 (decisions log)
--
-- `report_demandes(from, to)` (`reports.view`; Demandes enabled, else a French refusal) reads
-- only what Demandes publishes (`private.demandes_report_requests`, `_matches`, `_waitlist`,
-- `_capacity`), Rendez-vous' `private.appointments_cancelled_between` and
-- `appointments_first_after`, and Professionnels' names (`professional_display_names`,
-- `clientele_names`, `profession_title_names`: inactive rows keep their names). A period goes
-- from a clinic date to another, a year at most (RP-5). One jsonb (D-43 … D-45):
--   * `totals`: requests received (a request closed as a duplicate is not one: counted apart);
--     matches in the period (« activité ») and the rate ÷ received; the period's requests matched
--     since (« cohorte ») and their share; the promise (contacted within 2 business days, later;
--     not contacted yet within the delay, overdue; matched or closed without a contact); ever on
--     the waiting list.
--   * `weeks` and `months` (received, matches, first appointments cancelled; Monday first, in the
--     clinic's zone), `by_channel`, `by_counselor` (who took the request), `outcomes` (every
--     request of the period, duplicates included, by state and closing reason), `by_professional`,
--     `by_professional_week` and `by_clientele` (the period's matches).
--   * Sources (D3c's capture, R-74): `by_source` (« Comment avez-vous entendu parler de MANA ? »),
--     `by_campaign`, `by_utm`, `by_referrer`, each with how many were matched since; the last
--     three keep their 50 biggest values and fold the rest into one row (`other`).
--   * `delays`: received → first contact (business hours), → first proposal, → match (days).
--   * `first_appointments`: the first appointment after a match (whatever the match's date)
--     cancelled in the period, once each: how many, the rate ÷ the period's matches (it can pass
--     100 %), the notice (hours), the lead time (days from the match to the appointment), per
--     reason and per professional.
--   * `waitlist`: people (requests) waiting now, apart those whose registration is incomplete,
--     per list with « Prioritaire »; requests registered in the period; exits per reason; the wait
--     of the requests placed in the period.
--   * `places`: D5's last photo of the period (places left across the tracked professionals who
--     accept new clients, per professional) and the first photo of each week.
-- Additive: one RPC.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:reports_demandes', true);

create function public.report_demandes(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.reports_require('reports.view');
  v_bounds record;
  v_tz text;
  v_top constant int := 50;
  v_result jsonb;
begin
  perform private.reports_check_period(p_from, p_to);
  if not public.module_enabled_for_org(v_org, 'demandes') then
    raise exception 'Activez d''abord Demandes : ce rapport lit ses demandes.' using errcode = 'P0001', hint = 'module';
  end if;
  select * into v_bounds from private.reports_period_bounds(v_org, p_from, p_to);
  v_tz := coalesce((select o.timezone from public.organizations o where o.id = v_org), 'America/Toronto');

  with r_all as (
    select * from private.demandes_report_requests(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), r as (
    -- A duplicate is not a request received (the workbook's « new only »).
    select * from r_all where r_all.closed_reason is distinct from 'duplicate'
  ), m as (
    select * from private.demandes_report_matches(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), cx as (
    select * from private.appointments_cancelled_between(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), cand as (
    -- Only the matches whose client and professional have an appointment cancelled in the period.
    select x.*, pg_catalog.row_number() over (order by x.matched_at, x.event_id)::int as ord
      from private.demandes_report_matches(v_org, '-infinity'::timestamptz, v_bounds.ends_at) x
     where x.client_id is not null and x.professional_id is not null
       and exists (select 1 from cx where cx.client_id = x.client_id and cx.professional_id = x.professional_id)
  ), fa as (
    select c.*, f.appointment_id, f.starts_at as appt_starts_at
      from cand c
      join private.appointments_first_after(v_org, array(select y.client_id from cand y order by y.ord),
                                            array(select y.professional_id from cand y order by y.ord),
                                            array(select y.matched_at from cand y order by y.ord)) f on f.ord = c.ord
  ), fc as (
    -- Each first appointment once (two matches of the same pair reach the same one): the latest match.
    select distinct on (fa.appointment_id) fa.*, cx.cancelled_at, cx.reason_name
      from fa join cx on cx.appointment_id = fa.appointment_id and cx.client_id = fa.client_id
     order by fa.appointment_id, fa.matched_at desc
  ), w as (
    select * from private.demandes_report_waitlist(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), cap as (
    select * from private.demandes_report_capacity(v_org, p_from, p_to)
  ), last_day as (
    select pg_catalog.max(cap.snapshot_on) as d from cap
  ), pros as (
    select n.professional_id, n.display_name
      from private.professional_display_names(v_org, array(
             select m.professional_id from m where m.professional_id is not null
             union select fc.professional_id from fc
             union select cap.professional_id from cap
             union select w.target_id from w where w.target_kind = 'professional')) n
  ), titles as (
    select n.title_id, n.name from private.profession_title_names(v_org, array(select w.target_id from w where w.target_kind = 'title')) n
  ), clienteles as (
    select n.clientele_id, n.name from private.clientele_names(v_org, array(select m.clientele_id from m where m.clientele_id is not null)) n
  ), weeks as (
    select distinct pg_catalog.date_trunc('week', g)::date as week_start
      from pg_catalog.generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ), months as (
    select distinct pg_catalog.date_trunc('month', g)::date as month_start
      from pg_catalog.generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ), rw as (
    select pg_catalog.date_trunc('week', r.received_at at time zone v_tz)::date as wk, pg_catalog.count(*) as n from r group by 1
  ), mw as (
    select pg_catalog.date_trunc('week', m.matched_at at time zone v_tz)::date as wk, pg_catalog.count(*) as n from m group by 1
  ), fw as (
    select pg_catalog.date_trunc('week', fc.cancelled_at at time zone v_tz)::date as wk, pg_catalog.count(*) as n from fc group by 1
  ), rmo as (
    select pg_catalog.date_trunc('month', r.received_at at time zone v_tz)::date as mo, pg_catalog.count(*) as n from r group by 1
  ), mmo as (
    select pg_catalog.date_trunc('month', m.matched_at at time zone v_tz)::date as mo, pg_catalog.count(*) as n from m group by 1
  ), fmo as (
    select pg_catalog.date_trunc('month', fc.cancelled_at at time zone v_tz)::date as mo, pg_catalog.count(*) as n from fc group by 1
  ), campaigns as (
    select g.name, g.n, g.matched, pg_catalog.row_number() over (order by g.n desc, g.name) as rk
      from (select r.source_campaign as name, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
              from r where r.source_campaign is not null group by r.source_campaign) g
  ), utms as (
    select g.utm_source, g.utm_medium, g.n, g.matched,
           pg_catalog.row_number() over (order by g.n desc, g.utm_source nulls last, g.utm_medium nulls last) as rk
      from (select r.utm_source, r.utm_medium, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
              from r where r.utm_source is not null or r.utm_medium is not null group by r.utm_source, r.utm_medium) g
  ), referrers as (
    select g.host, g.n, g.matched, pg_catalog.row_number() over (order by g.n desc, g.host) as rk
      from (select r.referrer_host as host, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
              from r where r.referrer_host is not null group by r.referrer_host) g
  )
  select pg_catalog.jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (
      select pg_catalog.jsonb_build_object(
        'received', pg_catalog.count(*),
        'duplicates', (select pg_catalog.count(*) from r_all where r_all.closed_reason = 'duplicate'),
        'matched_activity', (select pg_catalog.count(*) from m),
        'activity_rate', case when pg_catalog.count(*) > 0
                              then pg_catalog.round(100.0 * (select pg_catalog.count(*) from m) / pg_catalog.count(*), 1) end,
        'matched_cohort', pg_catalog.count(*) filter (where r.first_matched_at is not null),
        'cohort_rate', case when pg_catalog.count(*) > 0
                            then pg_catalog.round(100.0 * pg_catalog.count(*) filter (where r.first_matched_at is not null) / pg_catalog.count(*), 1) end,
        'contacted_on_time', pg_catalog.count(*) filter (where r.contact_status = 'on_time'),
        'contacted_late', pg_catalog.count(*) filter (where r.contact_status = 'late'),
        'pending', pg_catalog.count(*) filter (where r.contact_status = 'pending'),
        'overdue', pg_catalog.count(*) filter (where r.contact_status = 'overdue'),
        'no_attempt', pg_catalog.count(*) filter (where r.contact_status = 'no_attempt'),
        'waitlisted', pg_catalog.count(*) filter (where r.ever_waitlisted))
        from r),
    'weeks', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'week_start', wk.week_start, 'received', coalesce(rw.n, 0), 'matched', coalesce(mw.n, 0),
               'first_cancelled', coalesce(fw.n, 0)) order by wk.week_start)
        from weeks wk
        left join rw on rw.wk = wk.week_start
        left join mw on mw.wk = wk.week_start
        left join fw on fw.wk = wk.week_start), '[]'),
    'months', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'month_start', mo.month_start, 'received', coalesce(rmo.n, 0), 'matched', coalesce(mmo.n, 0),
               'first_cancelled', coalesce(fmo.n, 0)) order by mo.month_start)
        from months mo
        left join rmo on rmo.mo = mo.month_start
        left join mmo on mmo.mo = mo.month_start
        left join fmo on fmo.mo = mo.month_start), '[]'),
    'by_channel', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('channel', g.channel, 'received', g.n, 'matched', g.matched) order by g.n desc, g.channel)
        from (select r.channel, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
                from r group by r.channel) g), '[]'),
    'by_counselor', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.received_by, 'name', g.name, 'received', g.n)
                                  order by g.n desc, g.name nulls last, g.received_by)
        from (select r.received_by, pg_catalog.max(r.received_by_name) as name, pg_catalog.count(*) as n from r group by r.received_by) g), '[]'),
    'outcomes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('state', g.state, 'closed_reason', g.closed_reason, 'count', g.n)
                                  order by g.n desc, g.state, g.closed_reason)
        from (select r_all.state, r_all.closed_reason, pg_catalog.count(*) as n from r_all group by r_all.state, r_all.closed_reason) g), '[]'),
    'by_professional', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.professional_id, 'name', p.display_name, 'matched', g.n)
                                  order by g.n desc, p.display_name nulls last, g.professional_id)
        from (select m.professional_id, pg_catalog.count(*) as n from m group by m.professional_id) g
        left join pros p on p.professional_id = g.professional_id), '[]'),
    'by_professional_week', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('week_start', g.wk, 'id', g.professional_id, 'name', p.display_name, 'matched', g.n)
                                  order by g.wk, g.n desc, p.display_name nulls last, g.professional_id)
        from (select pg_catalog.date_trunc('week', m.matched_at at time zone v_tz)::date as wk, m.professional_id, pg_catalog.count(*) as n
                from m group by 1, 2) g
        left join pros p on p.professional_id = g.professional_id), '[]'),
    'by_clientele', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.clientele_id, 'name', c.name, 'matched', g.n)
                                  order by g.n desc, c.name nulls last, g.clientele_id)
        from (select m.clientele_id, pg_catalog.count(*) as n from m group by m.clientele_id) g
        left join clienteles c on c.clientele_id = g.clientele_id), '[]'),
    'by_source', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.referral_source_id, 'name', g.name, 'received', g.n, 'matched', g.matched)
                                  order by g.n desc, g.name nulls last)
        from (select r.referral_source_id, pg_catalog.max(r.referral_source_name) as name, pg_catalog.count(*) as n,
                     pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
                from r group by r.referral_source_id) g), '[]'),
    'by_campaign', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'received', g.n, 'matched', g.matched, 'other', g.other)
                                  order by g.other, g.n desc, g.name)
        from (select case when c.rk <= v_top then c.name end as name, c.rk > v_top as other,
                     pg_catalog.sum(c.n)::int as n, pg_catalog.sum(c.matched)::int as matched
                from campaigns c group by 1, 2) g), '[]'),
    'by_utm', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('source', g.utm_source, 'medium', g.utm_medium, 'received', g.n,
                                                                'matched', g.matched, 'other', g.other)
                                  order by g.other, g.n desc, g.utm_source nulls last, g.utm_medium nulls last)
        from (select case when u.rk <= v_top then u.utm_source end as utm_source, case when u.rk <= v_top then u.utm_medium end as utm_medium,
                     u.rk > v_top as other, pg_catalog.sum(u.n)::int as n, pg_catalog.sum(u.matched)::int as matched
                from utms u group by 1, 2, 3) g), '[]'),
    'by_referrer', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('host', g.host, 'received', g.n, 'matched', g.matched, 'other', g.other)
                                  order by g.other, g.n desc, g.host)
        from (select case when x.rk <= v_top then x.host end as host, x.rk > v_top as other,
                     pg_catalog.sum(x.n)::int as n, pg_catalog.sum(x.matched)::int as matched
                from referrers x group by 1, 2) g), '[]'),
    'delays', (
      select pg_catalog.jsonb_build_object(
        'first_contact_hours', pg_catalog.jsonb_build_object(
          'count', pg_catalog.count(r.first_contact_hours),
          'median', pg_catalog.round((pg_catalog.percentile_cont(0.5) within group (order by r.first_contact_hours))::numeric, 1),
          'average', pg_catalog.round(pg_catalog.avg(r.first_contact_hours), 1)),
        'proposal_days', pg_catalog.jsonb_build_object(
          'count', pg_catalog.count(r.first_proposed_at),
          'median', pg_catalog.round((pg_catalog.percentile_cont(0.5) within group (
                      order by extract(epoch from r.first_proposed_at - r.received_at) / 86400))::numeric, 1),
          'average', pg_catalog.round(pg_catalog.avg(extract(epoch from r.first_proposed_at - r.received_at) / 86400)::numeric, 1)),
        'match_days', pg_catalog.jsonb_build_object(
          'count', pg_catalog.count(r.first_matched_at),
          'median', pg_catalog.round((pg_catalog.percentile_cont(0.5) within group (
                      order by extract(epoch from r.first_matched_at - r.received_at) / 86400))::numeric, 1),
          'average', pg_catalog.round(pg_catalog.avg(extract(epoch from r.first_matched_at - r.received_at) / 86400)::numeric, 1)))
        from r),
    'first_appointments', pg_catalog.jsonb_build_object(
      'matched', (select pg_catalog.count(*) from m),
      'cancelled', (select pg_catalog.count(*) from fc),
      'rate', case when (select pg_catalog.count(*) from m) > 0
                   then pg_catalog.round(100.0 * (select pg_catalog.count(*) from fc) / (select pg_catalog.count(*) from m), 1) end,
      'notice_hours', (select pg_catalog.jsonb_build_object(
                         'average', pg_catalog.round(pg_catalog.avg(extract(epoch from fc.appt_starts_at - fc.cancelled_at) / 3600)::numeric, 1),
                         'min', pg_catalog.round(pg_catalog.min(extract(epoch from fc.appt_starts_at - fc.cancelled_at) / 3600)::numeric, 1),
                         'max', pg_catalog.round(pg_catalog.max(extract(epoch from fc.appt_starts_at - fc.cancelled_at) / 3600)::numeric, 1))
                         from fc),
      'lead_days', (select pg_catalog.jsonb_build_object(
                      'average', pg_catalog.round(pg_catalog.avg(extract(epoch from fc.appt_starts_at - fc.matched_at) / 86400)::numeric, 1),
                      'min', pg_catalog.round(pg_catalog.min(extract(epoch from fc.appt_starts_at - fc.matched_at) / 86400)::numeric, 1),
                      'max', pg_catalog.round(pg_catalog.max(extract(epoch from fc.appt_starts_at - fc.matched_at) / 86400)::numeric, 1))
                      from fc),
      'by_reason', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'count', g.n) order by g.n desc, g.name nulls last)
          from (select fc.reason_name as name, pg_catalog.count(*) as n from fc group by fc.reason_name) g), '[]'),
      'by_professional', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.professional_id, 'name', p.display_name, 'count', g.n)
                                    order by g.n desc, p.display_name nulls last, g.professional_id)
          from (select fc.professional_id, pg_catalog.count(*) as n from fc group by fc.professional_id) g
          left join pros p on p.professional_id = g.professional_id), '[]')),
    'waitlist', pg_catalog.jsonb_build_object(
      'open', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('target_kind', g.target_kind, 'id', g.target_id,
                                                                  'name', coalesce(p.display_name, t.name),
                                                                  'waiting', g.waiting, 'incomplete', g.incomplete, 'priority', g.priority)
                                    order by g.target_kind desc, g.waiting desc, coalesce(p.display_name, t.name) nulls last, g.target_id)
          from (select w.target_kind, w.target_id,
                       pg_catalog.count(distinct w.demande_id) filter (where w.state <> 'incomplete') as waiting,
                       pg_catalog.count(distinct w.demande_id) filter (where w.state = 'incomplete') as incomplete,
                       pg_catalog.count(distinct w.demande_id) filter (where w.priority = 'priority') as priority
                  from w where w.state <> 'closed' group by w.target_kind, w.target_id) g
          left join pros p on g.target_kind = 'professional' and p.professional_id = g.target_id
          left join titles t on g.target_kind = 'title' and t.title_id = g.target_id), '[]'),
      'waiting_total', (select pg_catalog.count(distinct w.demande_id) from w where w.state not in ('closed', 'incomplete')),
      'incomplete_total', (select pg_catalog.count(distinct w.demande_id) from w where w.state = 'incomplete'
                              and not exists (select 1 from w y where y.demande_id = w.demande_id and y.state not in ('closed', 'incomplete'))),
      'registered', (select pg_catalog.count(distinct w.demande_id) from w where w.registered_at >= v_bounds.starts_at and w.registered_at < v_bounds.ends_at),
      'exits', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reason', g.exit_reason, 'count', g.n) order by g.n desc, g.exit_reason)
          from (select w.exit_reason, pg_catalog.count(distinct w.demande_id) as n from w
                 where w.exited_at >= v_bounds.starts_at and w.exited_at < v_bounds.ends_at group by w.exit_reason) g), '[]'),
      'wait_days', (
        select pg_catalog.jsonb_build_object(
          'count', pg_catalog.count(*),
          'average', pg_catalog.round(pg_catalog.avg(extract(epoch from x.exited_at - x.registered_at) / 86400)::numeric, 1),
          'median', pg_catalog.round((pg_catalog.percentile_cont(0.5) within group (
                      order by extract(epoch from x.exited_at - x.registered_at) / 86400))::numeric, 1))
          -- One per request placed (its first registration, its placement).
          from (select w.demande_id, pg_catalog.min(w.registered_at) as registered_at, pg_catalog.max(w.exited_at) as exited_at
                  from w where w.exit_reason = 'placed' and w.exited_at >= v_bounds.starts_at and w.exited_at < v_bounds.ends_at
                 group by w.demande_id) x)),
    'places', pg_catalog.jsonb_build_object(
      'snapshot_on', (select last_day.d from last_day),
      'total_left', (select coalesce(pg_catalog.sum(cap.places_left), 0) from cap, last_day
                      where cap.snapshot_on = last_day.d and cap.places_declared is not null and cap.accepting_new_clients),
      'tracked', (select pg_catalog.count(*) from cap, last_day where cap.snapshot_on = last_day.d and cap.places_declared is not null),
      'by_professional', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', cap.professional_id, 'name', p.display_name, 'declared', cap.places_declared,
                                                                  'left', cap.places_left, 'accepting', cap.accepting_new_clients)
                                    order by p.display_name nulls last, cap.professional_id)
          from cap join last_day on cap.snapshot_on = last_day.d
          left join pros p on p.professional_id = cap.professional_id
         where cap.places_declared is not null), '[]'),
      'weeks', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('week_start', g.week_start, 'snapshot_on', g.d, 'total_left', g.total)
                                    order by g.week_start)
          from (select pg_catalog.date_trunc('week', f.d)::date as week_start, f.d,
                       (select coalesce(pg_catalog.sum(c2.places_left), 0) from cap c2
                         where c2.snapshot_on = f.d and c2.places_declared is not null and c2.accepting_new_clients) as total
                  from (select pg_catalog.min(cap.snapshot_on) as d from cap group by pg_catalog.date_trunc('week', cap.snapshot_on)) f) g), '[]'))
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.report_demandes(date, date) from public, anon, authenticated;
grant execute on function public.report_demandes(date, date) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
