-- =============================================================================
-- Rapports: « Indicateurs des demandes » for the counselors (decision R-81)
-- =============================================================================
-- Decision: R-81 (decisions log, « Christine's answers, second series »: « utile pour la
--           provenance »); the scope is a default — révisable.
--
-- « Indicateurs des demandes » needed `reports.view`, which also opens « Annulations et
-- absences », « Clients à relancer » and « Consentements des clients » (admin only, D-42). It gets
-- a permission of its own, `reports.demandes_indicators`, that opens that report only:
-- * `report_demandes(from, to)` accepts it **or** `reports.view` (a role holding reports.view keeps
--   it); refused otherwise (42501, « Permission refusée : reports.demandes_indicators »). The rest
--   of the body is unchanged (latest: 20261014042305_clients_imports_security_fixes.sql).
-- * Defaults: the admin (every permission), the conseillère (R-81) and the adjointe. The adjointe
--   because she works the requests too (demandes.*) and because core's role guard lets a holder of
--   users.manage give a role only when she holds each of its defaults (`permission_keys_latent_for`,
--   CC-15): without it, an adjointe given users.manage could no longer give « Conseillère ».
--   Default — révisable.
-- * Template rows (`role_permissions`, `on conflict do nothing`): `role_permissions_propagate`
--   copies each into every existing clinic, `organizations_seed_role_permissions` into a new one.
--   In effect only while Rapports is enabled (it starts disabled).
-- Additive: one permission, three template rows, one function replaced (same signature, grants kept).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:reports_demandes_indicators', true);

insert into public.permissions (key, module_key, description) values
  ('reports.demandes_indicators', 'reports', 'Voir les indicateurs des demandes (activité, provenance, délais, liste d''attente)')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin',           'reports.demandes_indicators'),
  ('admin_assistant', 'reports.demandes_indicators'),
  ('counselor',       'reports.demandes_indicators')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- report_demandes: its own permission, or reports.view
-- -----------------------------------------------------------------------------
create or replace function public.report_demandes(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_bounds record;
  v_tz text;
  v_top constant int := 50;
  v_result jsonb;
begin
  -- R-81: its own permission (the counselors), or reports.view (every activity report) as before.
  if not (private.has_permission('reports.demandes_indicators') or private.has_permission('reports.view')) then
    raise exception 'Permission refusée : reports.demandes_indicators' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();
  perform private.reports_check_period(p_from, p_to);
  if not public.module_enabled('demandes') then
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

select pg_catalog.set_config('app.audit_source', '', true);
