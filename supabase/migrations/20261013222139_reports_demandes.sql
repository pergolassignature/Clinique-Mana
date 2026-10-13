-- =============================================================================
-- Rapports: « Demandes » — the intake indicators (Demandes batch D6, Rapports' RP2 intake part)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D6), §12 (RP2)
-- Data:      docs/research/2026-10-08-intake-workbook.md §8.3 (the workbook's KPIs, defined once)
-- Decisions: D-42 … D-45 (decisions log)
--
-- `report_demandes(from, to)` (`reports.view`; Demandes enabled, else a French refusal) reads
-- only what Demandes publishes (`private.demandes_report_requests`, `_matches`, `_waitlist`,
-- `_capacity`), Rendez-vous' `private.appointments_first_after` and Professionnels'
-- `private.professional_display_names`. A period goes from a clinic date to another, a year at
-- most (RP-5). It answers, as one jsonb:
--   * `totals`: requests received; matches in the period (« activité ») and its rate ÷ received;
--     the period's requests matched since (« cohorte ») and its rate; the 24–48 h promise (first
--     attempt within 48 business hours, later, never); ever on the waiting list.
--   * `weeks` (received and matches per week, Monday first, in the clinic's zone), `by_channel`,
--     `by_counselor` (who took the request), `outcomes` (the period's requests by state and
--     closing reason), `by_professional` and `by_clientele` (the period's matches).
--   * Sources (D3c's capture, R-74): `by_source` (« Comment avez-vous entendu parler de MANA ? »),
--     `by_campaign`, `by_utm` (utm_source / utm_medium), `by_referrer` (host), each with how many
--     of them were matched since.
--   * `delays`: received → first contact attempt (business hours), → first proposal, → match
--     (days): median, average, how many.
--   * `first_appointments`: the first appointment after each match (any match up to the period's
--     end) cancelled in the period: how many, the rate ÷ the period's matches, per reason, per
--     professional, the notice (hours between the cancellation and the start: average, min, max).
--   * `waitlist`: the entries open now per list (with « Prioritaire »), registered in the period,
--     exits in the period per reason, the wait of those placed in the period (days: average,
--     median).
--   * `places`: D5's photos: the last of the period (total left across the tracked professionals
--     who accept new clients, how many tracked, per professional) and the first photo of each week.
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
  v_result jsonb;
begin
  perform private.reports_check_period(p_from, p_to);
  if not public.module_enabled_for_org(v_org, 'demandes') then
    raise exception 'Activez d''abord Demandes : ce rapport lit ses demandes.' using errcode = 'P0001', hint = 'module';
  end if;
  select * into v_bounds from private.reports_period_bounds(v_org, p_from, p_to);
  v_tz := coalesce((select o.timezone from public.organizations o where o.id = v_org), 'America/Toronto');

  with r as (
    select * from private.demandes_report_requests(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), m as (
    select * from private.demandes_report_matches(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), all_m as (
    -- Every match up to the period's end, for the first appointments cancelled in the period.
    select x.*, pg_catalog.row_number() over (order by x.matched_at, x.event_id)::int as ord
      from private.demandes_report_matches(v_org, '-infinity'::timestamptz, v_bounds.ends_at) x
     where x.client_id is not null and x.professional_id is not null
  ), fa as (
    select a.*, f.ord as f_ord, f.starts_at as appt_starts_at, f.state as appt_state, f.cancelled_at, f.reason_name
      from all_m a
      join private.appointments_first_after(v_org, array(select y.client_id from all_m y order by y.ord),
                                            array(select y.professional_id from all_m y order by y.ord),
                                            array(select y.matched_at from all_m y order by y.ord)) f on f.ord = a.ord
  ), fc as (
    select * from fa where fa.appt_state = 'cancelled' and fa.cancelled_at >= v_bounds.starts_at and fa.cancelled_at < v_bounds.ends_at
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
             union select cap.professional_id from cap)) n
  ), weeks as (
    select pg_catalog.date_trunc('week', g)::date as week_start
      from pg_catalog.generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
     group by 1
  )
  select pg_catalog.jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (
      select pg_catalog.jsonb_build_object(
        'received', pg_catalog.count(*),
        'matched_activity', (select pg_catalog.count(*) from m),
        'activity_rate', case when pg_catalog.count(*) > 0
                              then pg_catalog.round(100.0 * (select pg_catalog.count(*) from m) / pg_catalog.count(*), 1) end,
        'matched_cohort', pg_catalog.count(*) filter (where r.first_matched_at is not null),
        'cohort_rate', case when pg_catalog.count(*) > 0
                            then pg_catalog.round(100.0 * pg_catalog.count(*) filter (where r.first_matched_at is not null) / pg_catalog.count(*), 1) end,
        'contacted_on_time', pg_catalog.count(*) filter (where r.first_contact_hours < 48),
        'contacted_late', pg_catalog.count(*) filter (where r.first_contact_hours >= 48),
        'not_contacted', pg_catalog.count(*) filter (where r.first_contact_at is null),
        'waitlisted', pg_catalog.count(*) filter (where r.ever_waitlisted))
        from r),
    'weeks', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'week_start', wk.week_start,
               'received', (select pg_catalog.count(*) from r where pg_catalog.date_trunc('week', r.received_at at time zone v_tz)::date = wk.week_start),
               'matched', (select pg_catalog.count(*) from m where pg_catalog.date_trunc('week', m.matched_at at time zone v_tz)::date = wk.week_start))
             order by wk.week_start)
        from weeks wk), '[]'),
    'by_channel', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('channel', g.channel, 'received', g.n, 'matched', g.matched) order by g.n desc, g.channel)
        from (select r.channel, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
                from r group by r.channel) g), '[]'),
    'by_counselor', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'received', g.n) order by g.n desc, g.name nulls last)
        from (select r.received_by_name as name, pg_catalog.count(*) as n from r group by r.received_by_name) g), '[]'),
    'outcomes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('state', g.state, 'closed_reason', g.closed_reason, 'count', g.n)
                                  order by g.n desc, g.state, g.closed_reason)
        from (select r.state, r.closed_reason, pg_catalog.count(*) as n from r group by r.state, r.closed_reason) g), '[]'),
    'by_professional', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'matched', g.n) order by g.n desc, g.name)
        from (select p.display_name as name, pg_catalog.count(*) as n from m left join pros p on p.professional_id = m.professional_id
               group by p.display_name) g), '[]'),
    'by_clientele', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'matched', g.n) order by g.n desc, g.name nulls last)
        from (select m.clientele_name as name, pg_catalog.count(*) as n from m group by m.clientele_name) g), '[]'),
    'by_source', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'received', g.n, 'matched', g.matched) order by g.n desc, g.name nulls last)
        from (select r.referral_source_name as name, pg_catalog.count(*) as n,
                     pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
                from r group by r.referral_source_name) g), '[]'),
    'by_campaign', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'received', g.n, 'matched', g.matched) order by g.n desc, g.name)
        from (select r.source_campaign as name, pg_catalog.count(*) as n,
                     pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
                from r where r.source_campaign is not null group by r.source_campaign) g), '[]'),
    'by_utm', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('source', g.utm_source, 'medium', g.utm_medium, 'received', g.n, 'matched', g.matched)
                                  order by g.n desc, g.utm_source nulls last, g.utm_medium nulls last)
        from (select r.utm_source, r.utm_medium, pg_catalog.count(*) as n,
                     pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
                from r where r.utm_source is not null or r.utm_medium is not null group by r.utm_source, r.utm_medium) g), '[]'),
    'by_referrer', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('host', g.host, 'received', g.n, 'matched', g.matched) order by g.n desc, g.host)
        from (select r.referrer_host as host, pg_catalog.count(*) as n,
                     pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
                from r where r.referrer_host is not null group by r.referrer_host) g), '[]'),
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
      'by_reason', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'count', g.n) order by g.n desc, g.name nulls last)
          from (select fc.reason_name as name, pg_catalog.count(*) as n from fc group by fc.reason_name) g), '[]'),
      'by_professional', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'count', g.n) order by g.n desc, g.name)
          from (select p.display_name as name, pg_catalog.count(*) as n from fc left join pros p on p.professional_id = fc.professional_id
                 group by p.display_name) g), '[]')),
    'waitlist', pg_catalog.jsonb_build_object(
      'open', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('target_kind', g.target_kind, 'name', g.target_name, 'count', g.n,
                                                                  'priority', g.priority)
                                    order by g.target_kind desc, g.n desc, g.target_name)
          from (select w.target_kind, w.target_name, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where w.priority = 'priority') as priority
                  from w where w.state <> 'closed' group by w.target_kind, w.target_name) g), '[]'),
      'open_total', (select pg_catalog.count(*) from w where w.state <> 'closed'),
      'registered', (select pg_catalog.count(*) from w where w.registered_at >= v_bounds.starts_at and w.registered_at < v_bounds.ends_at),
      'exits', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reason', g.exit_reason, 'count', g.n) order by g.n desc, g.exit_reason)
          from (select w.exit_reason, pg_catalog.count(*) as n from w
                 where w.exited_at >= v_bounds.starts_at and w.exited_at < v_bounds.ends_at group by w.exit_reason) g), '[]'),
      'wait_days', (
        select pg_catalog.jsonb_build_object(
          'count', pg_catalog.count(*),
          'average', pg_catalog.round(pg_catalog.avg(extract(epoch from w.exited_at - w.registered_at) / 86400)::numeric, 1),
          'median', pg_catalog.round((pg_catalog.percentile_cont(0.5) within group (
                      order by extract(epoch from w.exited_at - w.registered_at) / 86400))::numeric, 1))
          from w where w.exit_reason = 'placed' and w.exited_at >= v_bounds.starts_at and w.exited_at < v_bounds.ends_at)),
    'places', pg_catalog.jsonb_build_object(
      'snapshot_on', (select last_day.d from last_day),
      'total_left', (select coalesce(pg_catalog.sum(cap.places_left), 0) from cap, last_day
                      where cap.snapshot_on = last_day.d and cap.places_declared is not null and cap.accepting_new_clients),
      'tracked', (select pg_catalog.count(*) from cap, last_day where cap.snapshot_on = last_day.d and cap.places_declared is not null),
      'by_professional', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', p.display_name, 'declared', cap.places_declared,
                                                                  'left', cap.places_left, 'accepting', cap.accepting_new_clients)
                                    order by p.display_name)
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
